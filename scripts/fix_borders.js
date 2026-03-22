const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(filePath));
        } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
            results.push(filePath);
        }
    });
    return results;
}

const files = walk('./src');

let count = 0;
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    // Replace: borderBottom: '1px solid rgba(255,255,255,0.1)' -> borderBottom: '1px solid var(--border)'
    // Supports border, borderBottom, borderTop, borderLeft, borderRight
    // Supports 1px, 2px, solid, dashed
    // Supports rgba(255,255,255,X), rgba(150,150,150,X), rgba(128,128,128,X), rgba(0,0,0,0.1)

    const regex = /(border(?:Bottom|Top|Left|Right|Color)?\s*:\s*['"](?:[0-9]+px)?\s*(?:solid|dashed)\s*)rgba\(\s*(?:255|150|128|0|59)\s*,\s*(?:255|150|128|0|130)\s*,\s*(?:255|150|128|0|246)\s*,\s*0\.[0-9]+\s*\)(['"])/g;

    let newContent = content.replace(regex, "$1var(--border)$2");

    // Also replace standalone rgba borders like: border: '1px solid rgba(255,255,255,0.05)' 
    const regex2 = /(border(?:Bottom|Top|Left|Right|Color)?\s*:\s*['"])rgba\(\s*(?:255|150|128|0|59)\s*,\s*(?:255|150|128|0|130)\s*,\s*(?:255|150|128|0|246)\s*,\s*0\.[0-9]+\s*\)(['"])/g;
    newContent = newContent.replace(regex2, "$1var(--border)$2");

    if (newContent !== content) {
        fs.writeFileSync(file, newContent, 'utf8');
        count++;
        console.log(`Updated ${file}`);
    }
});

console.log(`Replaced border references in ${count} files.`);
