const sinon = require("sinon");
const lib = require("../lib");

const sandbox = sinon.createSandbox();

describe("lib.assertECRRepo", () => {
  beforeEach(() => {
    sandbox.restore();
  });

  after(() => {
    sandbox.restore();
  });

  it("resolves immediately if the repo already exists", async () => {
    const client = {
      send: sandbox.fake.resolves(),
    };

    expect(lib.assertECRRepo(client, "somerepo")).to.be.fulfilled;
    expect(client.send.calledOnce).to.be.true;
  });

  it("creates a repository if it does not exist");

  it("sets a repository policy on new repositories");

  it("rejects if it can't use DescribeRepository");

  it("it rejects if it can't create a new ecr repo");

  it("it rejects if it can't set an ecr policy");
});
