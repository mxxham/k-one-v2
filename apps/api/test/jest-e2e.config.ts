import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { experimentalDecorators: true, emitDecoratorMetadata: true } }],
  },
  globalSetup: '<rootDir>/global-setup.ts',
  testTimeout: 30000,
  maxWorkers: 1,
  forceExit: true,
  verbose: true,
};

export default config;