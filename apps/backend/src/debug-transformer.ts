import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

import { transformBookingToInvoiceData } from './services/invoice-data-transformer.js';
import { generateInvoicePDF } from './services/invoice-pdf-generator.js';
import { prisma } from '@repo/database/client';
import fs from 'fs';

async function runTest() {
    try {
        console.log('Testing transformation for booking 38...');
        const data = await transformBookingToInvoiceData(38);
        console.log('Transformation Success!');

        console.log('Testing PDF Generation...');
        const pdfBuffer = await generateInvoicePDF(data);
        console.log('PDF Generation Success! Buffer size:', pdfBuffer.length);

        fs.writeFileSync('test-invoice.pdf', pdfBuffer);
        console.log('Saved to test-invoice.pdf');

    } catch (error) {
        console.error('Test Failed:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
    } finally {
        await prisma.$disconnect();
    }
}

runTest();
