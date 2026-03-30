const fs = require('fs');
// read correctly from whichever directory we are in:
const filePath = fs.existsSync('convex/conversations.ts') 
    ? 'convex/conversations.ts' 
    : 'conversations.ts';

let code = fs.readFileSync(filePath, 'utf8');

// Replace normalize
code = code.replace(/function normalize\(value: string\): string \{\s*return value\.toLowerCase\(\)\.trim\(\);\s*\}/s, '');

// Replace EVENT_LINK_STOP_WORDS
code = code.replace(/const EVENT_LINK_STOP_WORDS = new Set\(\[[\s\S]*?\]\);/s, '');

// Replace eventSignalTokens
code = code.replace(/function eventSignalTokens\(event: \{[\s\S]*?\}\): string\[\] \{\s*const raw =[\s\S]*?return Array\.from\(new Set\(words\)\);\s*\}/s, '');

fs.writeFileSync(filePath, code);
console.log('done');
