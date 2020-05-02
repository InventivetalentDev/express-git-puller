console.log(JSON.stringify(Object.assign({},{
    x:"y",
    foo: "bar",
    nest: {
        nested: "idk",
        stuff: "thing"
    }
}, {
    x: "z",
    nest: {
        stuff: "nuffin"
    }
})));
