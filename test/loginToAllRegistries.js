const sinon = require("sinon");
const core = require("@actions/core");
const lib = require("../lib");

const sandbox = sinon.createSandbox();

describe("lib.loginToAllRegistries", () => {
  beforeEach(() => {
    sandbox.restore();
  });

  after(() => {
    sandbox.restore();
  });

  it("always logs into primary registry");

  it("splits registries on comma if there is a comma");

  it("splits registries on newline if no comma");

  it("asserts and logs into all other provided registries");

  it("returns additional docker build args and hosts");
});
