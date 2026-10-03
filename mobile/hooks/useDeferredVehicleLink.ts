import { useEffect, useRef } from 'react';
import { router, useSegments } from 'expo-router';
import { resolveDeferredVehicleLink } from '../lib/deferredLink';
import { useAuthStore } from '../store/auth';

// Once per JS runtime, however often the root layout re-renders or remounts.
let started = false;

/**
 * First launch after installing from a shared vehicle link (#16): open that
 * vehicle on top of the home tab. Mount once, in the root layout. Startup is
 * never held up — the lookup runs in the background and the vehicle is only
 * pushed if the user is still on the home tabs when it answers (an app opened
 * straight onto a vehicle link, or a user who already moved on, is left alone).
 */
export function useDeferredVehicleLink(): void {
  const segments = useSegments();
  const segmentsRef = useRef<string[]>(segments);
  segmentsRef.current = segments;
  const ready = segments.length > 0;

  useEffect(() => {
    if (!ready || started) return;
    started = true;
    resolveDeferredVehicleLink()
      .then((vehicleId) => {
        if (!vehicleId) return;
        // Staff land on the employee app; vehicle links are for customers.
        if (useAuthStore.getState().user?.role === 'STAFF') return;
        if (segmentsRef.current[0] !== '(tabs)') return;
        router.push({ pathname: '/vehicle/[id]', params: { id: vehicleId } });
      })
      .catch(() => {});
  }, [ready]);
}
