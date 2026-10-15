/* eslint-disable no-undef */
const request = require('supertest');

jest.mock('../database/database.js', () => ({
  DB: {
    addUser: jest.fn(async (user) => ({ ...user, id: 1, password: undefined })),
    deleteUser: jest.fn(async () => {}),
    getUsers: jest.fn(async () => [[{ id: 1, name: 'pizza diner', email: 'pizza@test.com', roles: [{ role: 'diner' }] }], false]),
    isLoggedIn: jest.fn(async () => true),
    loginUser: jest.fn(async () => {}),
  },
  Role: { Admin: 'admin', Diner: 'diner' },
}));

const { DB } = require('../database/database.js');
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

test('list users with pagination options', async () => {
  const [, userToken] = await registerUser(request(app));
  const pageUsers = [{ id: 2, name: 'second diner', email: 'second@test.com', roles: [{ role: 'diner' }] }];
  DB.getUsers.mockResolvedValueOnce([pageUsers, true]);

  const listUsersRes = await request(app)
    .get('/api/user?page=2&limit=1')
    .set('Authorization', 'Bearer ' + userToken);

  expect(listUsersRes.status).toBe(200);
  expect(DB.getUsers).toHaveBeenLastCalledWith('2', '1', undefined);
  expect(listUsersRes.body).toEqual({ users: pageUsers, more: true });
});

test('list users with name filter', async () => {
  const [, userToken] = await registerUser(request(app));
  const matchingUsers = [{ id: 1, name: 'pizza diner', email: 'pizza@test.com', roles: [{ role: 'diner' }] }];
  DB.getUsers.mockResolvedValueOnce([matchingUsers, false]);

  const listUsersRes = await request(app)
    .get('/api/user?name=pizza*')
    .set('Authorization', 'Bearer ' + userToken);

  expect(listUsersRes.status).toBe(200);
  expect(DB.getUsers).toHaveBeenLastCalledWith(undefined, undefined, 'pizza*');
  expect(listUsersRes.body).toEqual({ users: matchingUsers, more: false });
});

test('delete user unauthorized', async () => {
  const deleteUserRes = await request(app).delete('/api/user/1');
  expect(deleteUserRes.status).toBe(401);
  expect(DB.deleteUser).not.toHaveBeenCalled();
});

test('delete user', async () => {
  const [user, userToken] = await registerUser(request(app));
  const deleteUserRes = await request(app)
    .delete(`/api/user/${user.id}`)
    .set('Authorization', 'Bearer ' + userToken);

  expect(deleteUserRes.status).toBe(200);
  expect(DB.deleteUser).toHaveBeenCalledWith(user.id);
  expect(deleteUserRes.body).toEqual({ message: 'user deleted' });
});

test('cannot delete another user without admin role', async () => {
  DB.deleteUser.mockClear();
  const [, userToken] = await registerUser(request(app));
  const deleteUserRes = await request(app)
    .delete('/api/user/2')
    .set('Authorization', 'Bearer ' + userToken);

  expect(deleteUserRes.status).toBe(403);
  expect(DB.deleteUser).not.toHaveBeenCalled();
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
