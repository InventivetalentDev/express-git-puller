// Hello World Example from https://expressjs.com/en/starter/hello-world.html
const express = require('express')
const bodyParser = require('body-parser')
const {Puller} = require('./dist/src/index');
const app = express()
const port = 3000

app.use(bodyParser.json()) // Required for validating the request

// Register the puller middleware at the specified endpoint
const puller = new Puller({
    events: ["push"], // Events to listen for (optional, since you can select them on Github as well - set to * to handle all events)
    secret: "SuperSecretSecret", // Set this to verify the request against the secret provided to github
    vars: {
        appName: "ExampleApp"
    }
});
app.use("/_my_git_endpoint", puller.middleware);

app.get('/', (req, res) => res.send('Hello World!'))

app.listen(port, () => console.log(`Example app listening at http://localhost:${ port }`))
