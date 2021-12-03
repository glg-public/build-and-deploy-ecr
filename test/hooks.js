const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

global.expect = chai.expect;

// Determines if an array contains a set of items in order
Array.prototype.includesInOrder = function (...items) {
  for (let i = 0; i <= this.length - items.length; i++) {
    if (items.every((v, j) => this[i + j] === v)) {
      return true;
    }
  }
  return false;
};
