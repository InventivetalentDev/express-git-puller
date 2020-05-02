const TAG = "[ExpressGitPuller] ";
const crypto = require("crypto");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const DEFAULTS = {
    events: ["push"], // Events to react to
    secret: "", // Secret to validate github webhooks
    vars: { // Map of variables to replace in commands $<var name>$
        appName: "ExampleApp",
        remote: "origin",
        branch: "master"
    },
    commandOrder: ["pre", "git", "post"], // Order in which to run the command categories below
    commands: { // Commands to run
        pre: [],
        git: [
            "git fetch $remote$ $branch$",
            "git pull $remote$ $branch$"
        ],
        post: [
            "pm2 restart $appName$"
        ]
    },
    dryCommands: false, // Dry-run commands
    logCommands: false // Toggle command echo & output logging
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

        res.status(202).send("running");

        runAllCommands().then(() => {
        }).catch((err) => {
            console.warn(err);
        })
    };
};
