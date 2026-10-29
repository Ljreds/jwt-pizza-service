/* eslint-disable no-undef */
const request = require('supertest');

// Replace the real database module before the app loads. database.js connects to MySQL as soon as it is
// imported, so without this the tests would need a running database. Each jest.fn() is a fake we can inspect.
jest.mock('../database/database.js', () => ({
  DB: {
    // Used by POST /api/auth (register) to "create" a user.
    addUser: jest.fn(async (user) => ({ ...user, id: 1, password: undefined })),
    deleteUser: jest.fn(async () => {}),
    // Default page of users: [users, more].
    getUsers: jest.fn(async () => [[{ id: 1, name: 'pizza diner', email: 'pizza@test.com', roles: [{ role: 'diner' }] }], false]),
    // These two let the fake login token pass the auth middleware.
    isLoggedIn: jest.fn(async () => true),
    loginUser: jest.fn(async () => {}),
  },
  Role: { Admin: 'admin', Diner: 'diner' },
}));

// Require these after jest.mock so they receive the mocked database.
const { DB } = require('../database/database.js');
const app = require('../service.js');

// No Authorization header, so the authenticateToken middleware should reject the request.
test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

// Register a user to get a valid token, then check the response body matches what DB.getUsers returned.
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

// The route passes query-string values through untouched (as strings), so '2' and '1' are expected here.
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

// Options that aren't in the URL reach DB.getUsers as undefined, which is what triggers its default values.
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

// Without a token the request must be rejected before DB.deleteUser is ever reached.
test('delete user unauthorized', async () => {
  const deleteUserRes = await request(app).delete('/api/user/1');
  expect(deleteUserRes.status).toBe(401);
  expect(DB.deleteUser).not.toHaveBeenCalled();
});

// The mocked register always returns id 1, so this user deletes their own account, which is allowed.
test('delete user', async () => {
  const [user, userToken] = await registerUser(request(app));
  const deleteUserRes = await request(app)
    .delete(`/api/user/${user.id}`)
    .set('Authorization', 'Bearer ' + userToken);

  expect(deleteUserRes.status).toBe(200);
  expect(DB.deleteUser).toHaveBeenCalledWith(user.id);
  expect(deleteUserRes.body).toEqual({ message: 'user deleted' });
});

// The user is id 1 and tries to delete id 2 without the admin role, so the route must answer 403.
test('cannot delete another user without admin role', async () => {
  // Reset the call history left over from the earlier delete test so "not called" is meaningful.
  DB.deleteUser.mockClear();
  const [, userToken] = await registerUser(request(app));
  const deleteUserRes = await request(app)
    .delete('/api/user/2')
    .set('Authorization', 'Bearer ' + userToken);

  expect(deleteUserRes.status).toBe(403);
  expect(DB.deleteUser).not.toHaveBeenCalled();
});

// Registers a user through the real route (with the mocked DB) and returns [user, token].
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
