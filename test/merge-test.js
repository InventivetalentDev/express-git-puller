console.log(JSON.stringify(Object.assign({}, {
    x: "y",
    foo: "bar",
    nest: {
        nested: "idk",
        stuff: "thing"
    }
}, {
    x: "z",
    nest: {
        stuff: "nuffin",
        more: {
            a: "b"
        }
    }
})));

console.log(JSON.stringify({
    ...{
        x: "y",
        foo: "bar",
        nest: {
            nested: "idk",
            stuff: "thing"
        }
    }, ...{
        x: "z",
        nest: {
            stuff: "nuffin",
            more: {
                a: "b"
            }
        }
    }
}));
