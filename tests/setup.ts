if (!process.env.DEBUG) {
  global.console = { ...console, log: jest.fn(), info: jest.fn(), debug: jest.fn() };
}
process.env.NODE_ENV = "test";
