const mongoose = require('mongoose');

/**
 * Connect to MongoDB.
 *
 * Strategy:
 *  1. If USE_MEMORY_DB=true, start an in-memory MongoDB immediately.
 *  2. Otherwise try the real MONGO_URI.
 *  3. If the real connection fails, transparently fall back to an in-memory
 *     MongoDB so the project can still be demonstrated on any machine.
 */
async function connectDB() {
  const forceMemory = String(process.env.USE_MEMORY_DB).toLowerCase() === 'true';
  const production = process.env.NODE_ENV === 'production';

  if (production && (forceMemory || !process.env.MONGO_URI)) {
    throw new Error('A persistent MongoDB MONGO_URI is required in production.');
  }

  if (!forceMemory) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 3000,
      });
      console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn;
    } catch (err) {
      console.warn('⚠️  Could not connect to the configured MongoDB database.');
      console.warn(`    (${err.message})`);
      if (production) throw err;
      console.warn('    Falling back to an in-memory database for this session.');
    }
  }

  // In-memory fallback — data is not persisted between restarts.
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri();
  await mongoose.connect(uri);
  global.__MEM_DB__ = mem;
  console.log('✅ In-memory MongoDB started (data resets on restart).');
  console.log('   Tip: run "npm run seed" to load sample products & admin.');
  return mongoose.connection;
}

module.exports = connectDB;
