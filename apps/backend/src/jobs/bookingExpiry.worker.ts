import Redis from "ioredis";
import { prisma, BookingStatus } from "@repo/database/client";
import { createID } from "../utils/nanoID.js";


// Lazy initialization - connections created when needed, after env vars are loaded
let redis: Redis | null = null;
let redisSubscriber: Redis | null = null;

const FALLBACK_CRON_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function getRedisConfig() {
    const REDIS_URL = process.env.REDIS_URL;
    if (!REDIS_URL) {
        throw new Error("[BookingExpiry] REDIS_URL environment variable is required");
    }

    return {
        url: REDIS_URL,
        options: {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            connectTimeout: 30000, // 30 seconds
            enableOfflineQueue: false,
            retryStrategy(times: number) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            // TLS configuration for Azure Redis (rediss://)
            tls: REDIS_URL.startsWith('rediss://') ? {
                rejectUnauthorized: true,
            } : undefined,
        }
    };
}

function getRedisConnection(): Redis {
    if (!redis) {
        const { url, options } = getRedisConfig();
        redis = new Redis(url, options);

        // Add connection event handlers
        redis.on('connect', () => {
            console.log('[BookingExpiry] Redis client connected');
        });

        redis.on('ready', () => {
            console.log('[BookingExpiry] Redis client ready');
        });

        redis.on('error', (err) => {
            console.error('[BookingExpiry] Redis client error:', err.message);
        });

        redis.on('close', () => {
            console.log('[BookingExpiry] Redis client connection closed');
        });
    }
    return redis;
}

function getRedisSubscriber(): Redis {
    if (!redisSubscriber) {
        const { url, options } = getRedisConfig();
        redisSubscriber = new Redis(url, options);

        // Add connection event handlers for subscriber
        redisSubscriber.on('connect', () => {
            console.log('[BookingExpiry] Redis subscriber connected');
        });

        redisSubscriber.on('ready', () => {
            console.log('[BookingExpiry] Redis subscriber ready');
        });

        redisSubscriber.on('error', (err) => {
            console.error('[BookingExpiry] Redis subscriber error:', err.message);
        });

        redisSubscriber.on('close', () => {
            console.log('[BookingExpiry] Redis subscriber connection closed');
        });
    }
    return redisSubscriber;
}


async function enableKeyspaceNotifications(): Promise<void> {
    try {
        const redis = getRedisConnection();
        // Wait for Redis connection to be ready
        if (redis.status !== 'ready') {
            console.log('[BookingExpiry] Waiting for Redis connection to be ready...');
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Redis connection timeout'));
                }, 10000); // 10 second timeout

                redis.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                // If already ready by the time we set up the listener
                if (redis.status === 'ready') {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        }

        await redis.config("SET", "notify-keyspace-events", "Ex");
        console.log("[BookingExpiry] Keyspace notifications enabled (Ex)");
    } catch (error) {
        console.error("[BookingExpiry] Failed to enable keyspace notifications:", error);
        throw error;
    }
}

// ============================================================================
// BOOKING EXPIRY HANDLER
// ============================================================================

/**
 * Handles the expiration of a booking hold.
 * - Checks if booking exists and is still in HOLD status
 * - If yes, cancels the booking and cleans up Redis keys
 * - If already CONFIRMED or doesn't exist, does nothing
 */
async function handleBookingExpiry(bookingPublicId: string): Promise<void> {
    console.log(`[BookingExpiry] Processing expired booking: ${bookingPublicId}`);

    try {
        // Find the booking by publicId
        const booking = await prisma.booking.findUnique({
            where: { publicId: bookingPublicId },
            include: {
                items: {
                    include: { vehicle: true },
                },
            },
        });

        // Booking doesn't exist - might have been deleted
        if (!booking) {
            console.log(`[BookingExpiry] Booking ${bookingPublicId} not found in database, skipping`);
            return;
        }

        // Check if booking is still in HOLD status
        if (booking.status !== BookingStatus.HOLD) {
            console.log(
                `[BookingExpiry] Booking ${bookingPublicId} is already ${booking.status}, skipping cancellation`
            );
            return;
        }

        // Cancel the booking
        await prisma.$transaction(async (tx) => {
            // Update booking status to CANCELLED
            await tx.booking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.HOLD_EXPIRED,
                    holdExpiresAt: null,
                },
            });

            // Create audit log
            await tx.auditLog.create({
                data: {
                    publicId: createID(),
                    userId: booking.createdById,
                    action: "HOLD_EXPIRED",
                    entity: "Booking",
                    entityId: booking.publicId,
                    after: {
                        status: "HOLD_EXPIRED",
                        reason: "Hold expired",
                    },
                },
            });
        });

        // Clean up vehicle holds in Redis
        const redis = getRedisConnection();
        for (const item of booking.items) {
            const vehicleHoldKey = `vehicle_holds:${item.vehicle.publicId}`;
            await redis.srem(vehicleHoldKey, bookingPublicId);

            // If the set is empty, delete it
            const remainingHolds = await redis.scard(vehicleHoldKey);
            if (remainingHolds === 0) {
                await redis.del(vehicleHoldKey);
            }
        }

        console.log(`[BookingExpiry] Successfully cancelled expired booking: ${bookingPublicId}`);
    } catch (error) {
        console.error(`[BookingExpiry] Error processing booking ${bookingPublicId}:`, error);
    }
}

// ============================================================================
// EXPIRY EVENT LISTENER
// ============================================================================

/**
 * Subscribes to Redis keyspace notifications for expired keys.
 * Filters to only process booking publicIds (ignores vehicle_holds:* keys).
 */
async function startExpiryListener(): Promise<void> {
    const channel = "__keyevent@0__:expired";
    const redisSubscriber = getRedisSubscriber();

    // Wait for Redis subscriber to be ready
    if (redisSubscriber.status !== 'ready') {
        console.log('[BookingExpiry] Waiting for Redis subscriber to be ready...');
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Redis subscriber connection timeout'));
            }, 10000); // 10 second timeout

            redisSubscriber.once('ready', () => {
                clearTimeout(timeout);
                resolve();
            });

            // If already ready
            if (redisSubscriber.status === 'ready') {
                clearTimeout(timeout);
                resolve();
            }
        });
    }

    try {
        const count = await redisSubscriber.subscribe(channel);
        console.log(`[BookingExpiry] Subscribed to ${channel} (${count} channels)`);
    } catch (err) {
        console.error("[BookingExpiry] Failed to subscribe to expired events:", err);
    }

    redisSubscriber.on("message", async (channel, expiredKey) => {
        console.log(`[BookingExpiry] Received expired event for key: ${expiredKey}`);

        // Ignore vehicle_holds:* keys and other non-booking keys
        if (expiredKey.startsWith("vehicle_holds:")) {
            console.log(`[BookingExpiry] Ignoring vehicle hold key: ${expiredKey}`);
            return;
        }

        // Ignore keys that don't look like booking publicIds
        // Booking publicIds are typically nanoid format (21 chars alphanumeric)
        if (expiredKey.includes(":") || expiredKey.length < 10) {
            console.log(`[BookingExpiry] Ignoring non-booking key: ${expiredKey}`);
            return;
        }

        // Process the booking expiry
        await handleBookingExpiry(expiredKey);
    });

    redisSubscriber.on("error", (error) => {
        console.error("[BookingExpiry] Redis subscriber error:", error);
    });
}

// ============================================================================
// FALLBACK CRON JOB
// ============================================================================

/**
 * Fallback cron job that runs periodically to catch any expired bookings
 * that might have been missed (e.g., during Redis restart or network issues).
 */
async function runFallbackCleanup(): Promise<void> {
    console.log("[BookingExpiry] Running fallback cleanup...");

    try {
        const now = new Date();

        // Find all bookings that are in HOLD status with expired holdExpiresAt
        const expiredBookings = await prisma.booking.findMany({
            where: {
                status: BookingStatus.HOLD,
                holdExpiresAt: {
                    lt: now,
                },
            },
            select: {
                publicId: true,
            },
        });

        if (expiredBookings.length === 0) {
            console.log("[BookingExpiry] No expired bookings found in fallback cleanup");
            return;
        }

        console.log(`[BookingExpiry] Found ${expiredBookings.length} expired bookings in fallback cleanup`);

        // Process each expired booking
        for (const booking of expiredBookings) {
            await handleBookingExpiry(booking.publicId);
        }

        console.log("[BookingExpiry] Fallback cleanup completed");
    } catch (error) {
        console.error("[BookingExpiry] Error in fallback cleanup:", error);
    }
}

/**
 * Starts the fallback cron job using setInterval.
 */
function startFallbackCron(): void {
    console.log(
        `[BookingExpiry] Starting fallback cron (interval: ${FALLBACK_CRON_INTERVAL_MS / 1000}s)`
    );

    // Run immediately on startup
    runFallbackCleanup();

    // Then run at regular intervals
    setInterval(runFallbackCleanup, FALLBACK_CRON_INTERVAL_MS);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Main initialization function.
 * Call this on server startup to enable booking expiry handling.
 */
async function initBookingExpiryWorker(): Promise<void> {
    console.log("[BookingExpiry] Initializing booking expiry worker...");

    try {
        // Enable keyspace notifications
        await enableKeyspaceNotifications();

        // Start listening for expired events
        await startExpiryListener();

        // Start fallback cron as safety net
        startFallbackCron();

        console.log("[BookingExpiry] Booking expiry worker initialized successfully");
    } catch (error) {
        console.error("[BookingExpiry] Failed to initialize booking expiry worker:", error);
    }
}

// Export initialization function to be called from index.ts after env vars are loaded
// Do NOT auto-initialize here

// Export for manual initialization and testing purposes
export {
    handleBookingExpiry,
    runFallbackCleanup,
    initBookingExpiryWorker,
};
