import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/app.db");
const accounts = db.prepare("SELECT * FROM followed_accounts").all();
console.log("Followed Accounts in DB:");
console.log(JSON.stringify(accounts, null, 2));

const competitorAccounts = db.prepare("SELECT * FROM accounts").all();
console.log("\nCompetitor Accounts (accounts table):");
console.log(JSON.stringify(competitorAccounts, null, 2));

db.close();
