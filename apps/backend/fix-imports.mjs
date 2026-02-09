import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Recursively find all TypeScript files
function findTsFiles(dir, fileList = []) {
    const files = readdirSync(dir);

    files.forEach(file => {
        const filePath = join(dir, file);
        const stat = statSync(filePath);

        if (stat.isDirectory()) {
            findTsFiles(filePath, fileList);
        } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

const srcDir = join(__dirname, 'src');
const files = findTsFiles(srcDir);

let totalFixed = 0;
let filesModified = 0;

files.forEach(file => {
    let content = readFileSync(file, 'utf-8');
    const originalContent = content;

    // Regex to match relative imports without .js extension
    // Matches: from "./path" or from "../path" or from "../../path"
    // But NOT: from "express" or from "@types/node" (external modules)
    const importRegex = /from\s+["'](\.\.[\/\\].*?|\.\/.*?)["']/g;

    let modified = false;
    content = content.replace(importRegex, (match, importPath) => {
        // Skip if already has .js extension
        if (importPath.endsWith('.js')) {
            return match;
        }

        // Skip if it's a directory import (ends with /)
        if (importPath.endsWith('/')) {
            return match;
        }

        // Add .js extension
        modified = true;
        totalFixed++;
        return match.replace(importPath, importPath + '.js');
    });

    if (modified) {
        writeFileSync(file, content, 'utf-8');
        filesModified++;
        const relativePath = file.replace(srcDir, 'src');
        console.log(`✓ Fixed: ${relativePath}`);
    }
});

console.log(`\n✅ Complete! Fixed ${totalFixed} imports in ${filesModified} files.`);
