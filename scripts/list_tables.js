const sqlite3 = require('sqlite3').verbose();
const { PrismaClient } = require('@prisma/client');

const db = new sqlite3.Database('./dev.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the dev.db database.');
});

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
        if (err) {
            throw err;
        }
        console.log("Tables:");
        rows.forEach((row) => {
            console.log(row.name);
        });
        db.close();
    });
});
