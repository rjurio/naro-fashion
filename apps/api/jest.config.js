/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { ...require('./tsconfig.json').compilerOptions, isolatedModules: true } }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  // Phase 1 tests are pure unit tests (sanitiser, envelope, audit with
  // mocked Prisma). No DB, no Nest application boot.
  clearMocks: true,
};
