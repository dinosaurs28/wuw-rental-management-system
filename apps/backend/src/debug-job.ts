import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

import { getInvoiceQueue } from "./lib/queue.client.js";

async function checkFailedJobs() {
  try {
    console.log("Checking failed jobs...");
    const queue = getInvoiceQueue();

    // Get failed jobs
    const failedJobs = await queue.getFailed();
    console.log(`Found ${failedJobs.length} failed jobs`);

    if (failedJobs.length > 0) {
      // Get the most recent failed job
      const job: any = failedJobs[0]; // Most recent is usually first or last depending on implementation, let's check sorting if needed but simple access is fine for now or we iterate.

      // Actually getFailed returns array. Let's look at the specific one we are interested in or just the last one.
      // Let's grab the specific ID if we know it, otherwise list them.

      console.log("--- Most Recent Failed Job ---");
      console.log("ID:", job.id);
      console.log("Data:", job.data);
      console.log("Failed Reason:", job.failedReason);
      console.log("Stack Trace:", job.stacktrace);
      console.log("------------------------------");
    } else {
      // If no failed jobs in list (maybe cleaned up?), try getting the specific job by ID if known, or just active ones.
      console.log(
        "No failed jobs found in registry. Checking active/waiting...",
      );
    }

    const job15 = await queue.getJob("invoice-15");
    if (job15) {
      console.log("--- Job invoice-15 Status ---");
      console.log("State:", await job15.getState());
      console.log("Failed Reason:", job15.failedReason);
      console.log("Stack:", job15.stacktrace);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkFailedJobs();
