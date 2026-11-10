jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));
jest.mock('../config.js', () => ({
  db: { connection: { database: 'test' } },
}));

const mysql = require('mysql2/promise');
const initConnection = {
  query: jest.fn().mockResolvedValue([]),
  execute: jest.fn().mockResolvedValue([[{ SCHEMA_NAME: 'test' }]]),
  end: jest.fn(),
};
mysql.createConnection.mockResolvedValue(initConnection);

const { DB } = require('./database.js');

test('counts distinct logged-in users and closes the connection', async () => {
  await DB.initialized;
  const connection = {
    execute: jest.fn().mockResolvedValue([[{ count: 2 }]]),
    end: jest.fn(),
  };
  const getConnection = jest.spyOn(DB, 'getConnection').mockResolvedValue(connection);
  try {
    await expect(DB.getActiveUserCount()).resolves.toBe(2);
    expect(connection.execute).toHaveBeenCalledWith('SELECT COUNT(DISTINCT userId) AS count FROM auth', undefined);
    expect(connection.end).toHaveBeenCalledTimes(1);
  } finally {
    getConnection.mockRestore();
  }
});

test('closes the connection if the active user query fails', async () => {
  await DB.initialized;
  const connection = {
    execute: jest.fn().mockRejectedValue(new Error('Query failed')),
    end: jest.fn(),
  };
  const getConnection = jest.spyOn(DB, 'getConnection').mockResolvedValue(connection);
  try {
    await expect(DB.getActiveUserCount()).rejects.toThrow('Query failed');
    expect(connection.end).toHaveBeenCalledTimes(1);
  } finally {
    getConnection.mockRestore();
  }
});
