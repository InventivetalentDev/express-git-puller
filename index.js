const TAG = "[ExpressGitPuller] ";
const crypto = require("crypto");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const DEFAULTS = {
    events: ["push"], // Events to react to
    secret: "", // Secret to validate github webhooks
    token: "", // Additional to check for in query params (https://example.com/git_hook?token=12345)
    vars: { // Map of variables to replace in commands $<var name>$
        appName: "ExampleApp",
        remote: "origin",
        branch: "master"
    },
    pusherIgnoreRegex: /\[bot\]/i,// Ignore pushers matching this regex
    commandOrder: ["pre", "git", "install", "post"], // Order in which to run the command categories below
    commands: { // Commands to run
        pre: [],
        git: [
            "git fetch $remote$ $branch$",
            "git pull $remote$ $branch$"
        ],
        install: [
            "npm install"
        ],
        post: [
            "pm2 restart $appName$"
        ]
    },
    dryCommands: false, // Dry-run commands
    logCommands: false, // Toggle command echo & output logging
    beforeRun: null, // callback function for when the commands are about to be run - will be called with webhook req and res; return false to cancel commands
    afterRun: null // same as beforeRun, but called when done (does not run if the last commands include stuff to restart the app) - called with req, res, and an optional error
};

module.exports = exports = function (config) {
    config = Object.assign({}, DEFAULTS, config);
    config.vars = Object.assign({}, DEFAULTS.vars, config.vars || {});
    config.commands = Object.assign({}, DEFAULTS.commands, config.commands || {});

    function replaceVars(str) {
        for (let v in config.vars) {
            str = str.replace(new RegExp("\\$" + v + "\\$", "g"), config.vars[v]);
        }
        return str;
    }

    async function runAllCommands() {
        if (config.logCommands) console.log(TAG + "Running commands!")
        for (let cat of config.commandOrder) {
            await runCategoryCommands(cat);
        }
    }

    async function runCategoryCommands(cat/*meow*/) {
        if (!config.commands.hasOwnProperty(cat)) {
            console.warn(TAG + "Tried to run commands of " + cat + " category, but category does not exist");
            return false;
        }
        for (let cmd of config.commands[cat]) {
            await runCommand(cmd);
        }
    }

    async function runCommand(cmd) {
        cmd = replaceVars(cmd);
        if (config.logCommands || config.dryCommands) console.log(TAG + "RUN " + (config.dryCommands ? "(dry) " : "") + cmd);
        if (!config.dryCommands) {
            const {stdout, stderr} = await exec(cmd);
            if (config.logCommands) {
                console.log(stdout);
                console.warn(stderr);
            }
        }
    }

    return function (req, res, next) {
        if (!req.headers["user-agent"]) {
            res.status(400).send("missing user agent header");
            return;
        }
        if (!req.headers["user-agent"].startsWith("GitHub-Hookshot/")) {
            res.status(400).send("invalid user agent");
            return;
        }
        const event = req.headers["x-github-event"];
        if (config.events !== "*" && config.events[0] !== "*" && config.events.indexOf(event) === -1) {
            // Event not configured to be handled - just ignore it
            res.status(200).send();
            return;
        }
        if (!req.query.token || req.query.token.length === 0) {// missing token
            if (config.token && config.token.length > 0) {// token is configured -> disallow request
                res.status(401).send("missing token");
                return;
            }
            // no token configured -> allow by default
        } else {
            if (config.token !== req.query.token) { // tokens don't match
                console.warn(TAG + "Received webhook request with invalid token");
                res.status(401).send("invalid token");
                return;
            }
        }
        if (!req.headers["x-hub-signature"] || req.headers["x-hub-signature"].length === 0) {// missing signature header
            if (config.secret && config.secret.length > 0) { // a secret is configured locally -> disallow the request
                res.status(401).send("missing request signature");
                return;
            }
            // If there is no secret, allow the request since there's nothing to verify against
        } else { // validate signature (https://gist.github.com/stigok/57d075c1cf2a609cb758898c0b202428)
            if (!req.body) {
                console.warn(TAG + "Missing request body. Is body-parser installed properly?");
                res.status(400).send("missing body");
                return;
            }
            const bodyString = JSON.stringify(req.body);
            const signature = req.headers["x-hub-signature"];
            const hmac = crypto.createHmac('sha1', config.secret);
            const digest = Buffer.from("sha1=" + hmac.update(bodyString).digest("hex"), "utf8");
            const checksum = Buffer.from(signature, "utf8");
            if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
                console.warn(TAG + "Received webhook request with invalid signature (Body " + digest + " did not match header " + checksum + ")");
                res.status(401).send("invalid signature");
                return;
            }
            // Signature valid
        }

        if (req.body.pusher && req.body.pusher.name && config.pusherIgnoreRegex.test(req.body.pusher.name)) {
            res.status(200).send("ignoring pusher " + req.body.pusher);
            return;
        }

        res.status(202).send("running");

        if (typeof config.beforeRun === "function") {
            if (config.beforeRun(req, res) === false) {
                return;
            }
        }

        runAllCommands().then(() => {
            if (typeof config.afterRun === "function") {
                config.afterRun(req, res);
            }
        }).catch((err) => {
            console.warn(err);
            if (typeof config.afterRun === "function") {
                config.afterRun(req, res, err);
            }
        });


    };
};
