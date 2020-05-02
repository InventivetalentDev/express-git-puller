let v = "testVar";
let str = "Hello $testVar$";
let r = "World";

console.log(str.replace(new RegExp("\\$" + v + "\\$", "g"), r));
