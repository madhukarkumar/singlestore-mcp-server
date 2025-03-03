#!/usr/bin/env node
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '.env');

console.log(`Checking .env file at: ${envPath}`);
console.log(`File exists: ${fs.existsSync(envPath)}`);

if (fs.existsSync(envPath)) {
  console.log(`File content (first line redacted if contains password):`);
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('PASSWORD') || line.includes('password')) {
      console.log(`${i+1}: [REDACTED PASSWORD]`);
    } else if (line.trim() !== '') {
      console.log(`${i+1}: ${line}`);
    }
  }
}

console.log('\nLoading environment variables...');
dotenv.config({ path: envPath });

console.log('\nEnvironment variables loaded:');
const relevantKeys = Object.keys(process.env).filter(key => 
  key.includes('SINGLE') || key.includes('DB_') || key.includes('MCP')
);

console.log('All relevant environment variable keys:', relevantKeys.join(', '));

relevantKeys.forEach(key => {
  if (key.includes('PASSWORD') || key.includes('password')) {
    console.log(`${key}: [REDACTED]`);
  } else {
    console.log(`${key}: ${process.env[key]}`);
  }
});
