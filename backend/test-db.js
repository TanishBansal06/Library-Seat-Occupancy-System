const db = require('./db');
require('dotenv').config();

async function testConnection() {
  console.log('======================================================');
  console.log('TIET Library Seat System: Database Connection Diagnostics');
  console.log('======================================================');
  console.log(`DB User:              ${process.env.DB_USER}`);
  console.log(`DB Connection String: ${process.env.DB_CONNECTION_STRING}`);
  console.log(`Mode:                 Thin Mode (pure JavaScript, clientless)`);
  console.log('======================================================');
  
  try {
    console.log('1. Initializing Oracle connection pool...');
    await db.initialize();
    console.log('   [SUCCESS] Pool is ready.');
    
    console.log('\n2. Testing basic connectivity (SELECT SYSDATE FROM DUAL)...');
    const result = await db.execute('SELECT SYSDATE AS current_db_time FROM dual');
    console.log('   [SUCCESS] Connected to DB.');
    console.log('   Database Server Time:', result.rows[0].CURRENT_DB_TIME || result.rows[0].current_db_time);
    
    console.log('\n3. Verifying system schema objects...');
    const tables = ['student', 'floor', 'seat', 'allocation', 'scan_log'];
    for (const table of tables) {
      try {
        const countRes = await db.execute(`SELECT COUNT(*) AS cnt FROM ${table}`);
        const count = countRes.rows[0].CNT;
        console.log(`   [FOUND] Table "${table.toUpperCase()}" contains ${count} records.`);
      } catch (err) {
        console.warn(`   [ERROR] Table "${table.toUpperCase()}" search failed:`, err.message.split('\n')[0]);
      }
    }
    
    console.log('\n4. Verifying sequence counters...');
    const sequences = ['seat_seq', 'alloc_seq', 'scan_seq'];
    for (const seq of sequences) {
      try {
        // Query next value or check if sequence exists by querying user_sequences
        const seqRes = await db.execute(`SELECT sequence_name FROM user_sequences WHERE sequence_name = :seq_name`, {
          seq_name: seq.toUpperCase()
        });
        if (seqRes.rows && seqRes.rows.length > 0) {
          console.log(`   [FOUND] Sequence "${seq.toUpperCase()}" exists.`);
        } else {
          console.warn(`   [WARNING] Sequence "${seq.toUpperCase()}" was not found in user_sequences schema.`);
        }
      } catch (err) {
        console.warn(`   [ERROR] Sequence "${seq.toUpperCase()}" verification error:`, err.message.split('\n')[0]);
      }
    }

    console.log('\n======================================================');
    console.log('DIAGNOSTICS COMPLETE: Database connection is healthy.');
    console.log('======================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[FATAL ERROR] Connection diagnostics failed!');
    console.error('Error Details:', err.message);
    console.error('======================================================');
    console.error('Please verify that:');
    console.error('1. Your Oracle XE / Free service is up and running.');
    console.error('2. The port 1521 is accessible.');
    console.error('3. The credentials in your .env file are correct.');
    console.error('4. schema.sql was run successfully on the schema.');
    console.error('======================================================');
    process.exit(1);
  }
}

testConnection();
