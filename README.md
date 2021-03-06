# Express Git Puller

Module to act as an express endpoint for receiving Github webhooks & running commands, e.g. for automatically pulling code from Git after pushing & restarting a pm2 app

#### Prerequisites
* The process directory should have `git init`alized
* The `git remote` should also be configured
* Also make sure to add any files you don't want to be overwritten to the `.gitignore`

##### Install
```shell script
npm install --save express-git-puller
```

##### Basic Server Example
```javascript
// Hello World Example from https://expressjs.com/en/starter/hello-world.html
const express = require('express')
const bodyParser = require('body-parser')
const {Puller} = require('express-git-puller');
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
```

##### Github Webhook Example
![](https://yeleha.co/2WjQdIb)
* Obviously use your project's public domain
* Set Content type to `application/json`
* (optional) Set a secret and add it to the puller config
* (optional) Choose which events should be sent to the webhook - also make sure to change the puller config respectively
