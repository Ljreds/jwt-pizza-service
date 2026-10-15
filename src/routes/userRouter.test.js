/* eslint-disable no-undef */
const request = require('supertest');

jest.mock('../database/database.js', () => ({
  DB: {
    addUser: jest.fn(async (user) => ({ ...user, id: 1, password: undefined })),
    getUsers: jest.fn(async () => [[{ id: 1, name: 'pizza diner', email: 'pizza@test.com', roles: [{ role: 'diner' }] }], false]),
    isLoggedIn: jest.fn(async () => true),
    loginUser: jest.fn(async () => {}),
  },
  Role: { Diner: 'diner' },
}));

const app = require('../service.js');

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users', async () => {
  const [, userToken] = await registerUser(request(app));
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + userToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual({
    users: [{ id: 1, name: 'pizza diner', email: 'pizza@test.com', roles: [{ role: 'diner' }] }],
    more: false,
  });
});

async function registerUser(service) {
  const testUser = {
    name: 'pizza diner',
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const registerRes = await service.post('/api/auth').send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

