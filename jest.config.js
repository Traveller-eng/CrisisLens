module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleFileExtensions: ["ts", "js", "json"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["shared/**/*.ts", "!shared/demo-data.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true
        }
      }
    ]
  }
};
