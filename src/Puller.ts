import { EventEmitter } from "events";
import { Request, Response, NextFunction, RequestHandler, Application } from "express";
import { PathParams } from "express-serve-static-core";
import { exec } from "child_process";
import * as crypto from "crypto";
import { GithubBody, GithubHeaders } from "./Github";

const TAG = "[ExpressGitPuller] ";

const DEFAULT_OPTIONS: Options = {
    events: ["push"], // Events to react to
    secret: "", // Secret to validate github webhooks
    token: "", // Additional to check for in query params (https://example.com/git_hook?token=12345)
    vars: { // Map of variables to replace in commands $<var name>$
        appName: "ExampleApp",
        remote: "origin",
        branch: "master"
    },
    pusherIgnoreRegex: /\[bot\]/i,// Ignore pushers matching this regex
    commitIgnoreRegex: /\[nopull\]/i,
    branches: ["main", "master"],
    onlyTags: false,
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
    delays: {
        pre: 0,
        git: 0,
        install: 0,
        post: 0
    },
    dryCommands: false, // Dry-run commands
    logCommands: false, // Toggle command echo & output logging
};

type OptionVars = { [s: string]: string };
type OptionCommands = { [s: string]: string[] };
type OptionDelays = { [s: string]: number };

export interface Options {
    /**
     * Webhook events to react to<br/>
     * Defaults to <code>[push]</code>
     */
    events?: string[];

    /**
     * Secret to validate github webhooks
     */
    secret?: string;

    /**
     * Additional token to check in query params (https://example.com/git_hook?token=12345)
     */
    token?: string;

    /**
     * Map of variables to replace in commands $<var name>$<br/>
     * Defaults to <br/>
     * <code>
     * {
     *     appName: "ExampleApp",
     *     remote: "origin",
     *     branch: "main"
     * }
     * </code>
     */
    vars?: OptionVars;

    /**
     * Ignore pushers with names matching this regex<br/>
     * Defaults to <code>/\[bot\]/i</code>
     */
    pusherIgnoreRegex?: RegExp;

    /**
     * Ignore commit messages matching this regex<br/>
     * Defaults to <code>/\[nopull\]/i</code>
     */
    commitIgnoreRegex?: RegExp;

    /**
     * Branches to react to<br/>
     * Defaults to <code>[main, master]</code>
     */
    branches?: string[];

    /**
     * Whether to require tags to pull anything<br/>
     * Defaults to <code>false</code>
     */
    onlyTags?: boolean;

    /**
     * Order in which to run the command categories in <code>commands</code><br/>
     * Defaults to <code>[pre, git, install, post]</code>
     */
    commandOrder?: string[];

    /**
     * Commands to run (by category)<br/>
     * Defaults to <br/>
     * <code>
     *      pre: [],
     *      git: [
     *          "git fetch $remote$ $branch$",
     *          "git pull $remote$ $branch$"
     *      ],
     *      install: [
     *          "npm install"
     *      ],
     *      post: [
     *          "pm2 restart $appName$"
     *      ]
     * </code>
     */
    commands?: OptionCommands;

    /**
     * Delay (in ms) to wait before running command categories<br/>
     * Defaults to <br/>
     * <code>
     *      pre: 0,
     *      git: 0,
     *      install: 0,
     *      post: 0
     * </code>
     */
    delays?: OptionDelays;

    /**
     * Dry-run commands (only log commands without running them)
     */
    dryCommands?: boolean;

    /**
     * Log commands & their outputs
     */
    logCommands?: boolean;

    /**
     * Function to call as an additional check before running anything
     */
    precondition?: (req: Request, res: Response) => boolean;
}

interface PullerEventEmitter {
    // @formatter:off

    on(event: "error", listener: (error: any) => void): this;
    on(event: "before", listener: (req: Request, res: Response) => void): this;
    on(event: "after", listener: (req: Request, res: Response, error?: any) => void): this;

    once(event: "error", listener: (error: any) => void): this;
    once(event: "before", listener: (req: Request, res: Response) => void): this;
    once(event: "after", listener: (req: Request, res: Response, error?: any) => void): this;

    off(event: "error", listener: (error: any) => void): this;
    off(event: "before", listener: (req: Request, res: Response) => void): this;
    off(event: "after", listener: (req: Request, res: Response, error?: any) => void): this;

    emit(name: "error", error: any): boolean;
    emit(name: "expire", req: Request, res: Response): boolean;
    emit(name: "stat", req: Request, res: Response, error?: any): boolean;

    // @formatter:on
}

export class Puller extends EventEmitter implements PullerEventEmitter {

    private readonly _options: Options;

    constructor(options?: Options) {
        super();
        this._options = { ...DEFAULT_OPTIONS, ...options };
        this._options.vars = { ...DEFAULT_OPTIONS.vars, ...options.vars };
        this._options.commands = { ...DEFAULT_OPTIONS.commands, ...options.commands };
        this._options.delays = { ...DEFAULT_OPTIONS.delays, ...options.delays };
    }

    //// PUBLIC STUFF

    get options(): Options {
        return { ...this._options };
    }

    get middleware(): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
            this.handleRequest(req, res);
        };
    }

    addTo(app: Application, path: PathParams): Application {
        return app.use(path, this.middleware);
    }

    //// REQUEST STUFF

    // OPTION CHECKS

    protected handleRequest(req: Request, res: Response): boolean {
        if (!this.validateRequest(req, res)) {
            return false;
        }

        const body = req.body as GithubBody;
        const headers = req.headers as GithubHeaders;

        if (!this.shouldHandleEvent(body, headers, req)) {
            res.status(200).send();
            return false;
        }
        if (!this.shouldHandleRef(body, headers, req)) {
            res.status(200).send();
            return false;
        }
        if (!this.shouldHandlePusher(body, headers, req)) {
            res.status(200).send();
            return false;
        }
        if (!this.shouldHandleCommit(body, headers, req)) {
            res.status(200).send();
            return false;
        }

        if (!this.validateToken(body, headers, req)) {
            res.status(401).send("invalid token");
            console.warn(TAG + "Received webhook request with invalid token");
            return false;
        }

        if (!this.validateSignature(body, headers, req)) {
            res.status(401).send("invalid signature");
            console.warn(TAG + "Received webhook request with invalid signature");
            return false;
        }

        if (this._options.precondition) {
            if (this._options.precondition(req, res) === false) {
                return false;
            }
        }

        res.status(200).send("running");

        this.emit("before", req, res);
        this.runAllCommands().then(() => {
            this.emit("after", req, res);
        }).catch(err => {
            this.emit("error", err);
            this.emit("after", req, res, err);
        })

        return true;
    }

    protected shouldHandleEvent(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (this._options.events.length <= 0) return false;
        if (this._options.events[0] === "*") return true;
        const event = headers["x-github-event"] as string;
        return this._options.events.includes(event);
    }

    protected shouldHandleRef(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (this._options.branches.length <= 0) return false;
        if (this._options.branches[0] === "*") return true;
        if (this._options.onlyTags) {
            // body.ref has tag/head info
            if (!body.ref.startsWith("refs\/tags\/")) return false; // not a tag
        }
        // body.base_ref exists if there's a tag in body.ref
        if (!body.ref && !body.base_ref) return false;
        const branch = (body.base_ref || body.ref).replace(/refs\/heads\//, "");
        return this._options.branches.includes(branch.trim());
    }

    protected shouldHandlePusher(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (!this._options.pusherIgnoreRegex) return true;
        if (!body.pusher) return true;
        if (body.pusher.name && this._options.pusherIgnoreRegex.test(body.pusher.name)) {
            // ignored
            return false;
        }
        return true;
    }

    protected shouldHandleCommit(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (!this._options.commitIgnoreRegex) return true;
        if (!body.head_commit && !body.commits) return true;
        const commit = body.head_commit || body.commits[0];
        if (commit && this._options.commitIgnoreRegex.test(commit.message)) {
            // ignore
            return false;
        }
        return true;
    }

    // VALIDATIONS

    protected validateToken(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (!this._options.token || this._options.token.length <= 0) return true; // no token configured
        const token = req.query.token as string;
        if (!token || token.length <= 0) return false;
        // check token
        return token === this._options.token
    }

    protected validateSignature(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (!this._options.secret || this._options.secret.length <= 0) return true; // no secret configured
        const signature = headers["x-hub-signature"] as string;
        if (!signature || signature.length <= 0) return false;
        // validate signature (https://gist.github.com/stigok/57d075c1cf2a609cb758898c0b202428)
        const bodyStr = JSON.stringify(req.body);
        const hmac = crypto.createHmac('sha1', this._options.secret);
        const digest = Buffer.from("sha1=" + hmac.update(bodyStr).digest('hex'), 'utf8');
        const checksum = Buffer.from(signature, 'utf8');
        if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
            console.warn(TAG + "Received webhook request with invalid signature (Body " + digest + " did not match header " + checksum + ")");
            return false;
        }
        return true;
    }

    protected validateRequest(req: Request, res: Response): boolean {
        if (req.method.toLowerCase() !== "post") {
            res.status(400).send("invalid request method");
            return false;
        }
        if (!req.headers["user-agent"] || req.headers["user-agent"].length <= 0) {
            res.status(400).send("missing user agent header");
            return false;
        }
        if (!req.headers["user-agent"].startsWith("GitHub-Hookshot/")) {
            res.status(400).send("invalid user agent");
            return false;
        }
        if (!req.headers["x-hub-signature"] || req.headers["x-hub-signature"].length <= 0) {
            res.status(400).send("missing request signature");
            return false;
        }
        if (!req.headers["x-github-event"] || req.headers["x-github-event"].length <= 0) {
            res.status(400).send("missing event");
            return false;
        }
        if (!req.body || req.body.length <= 0) {
            res.status(400).send("missing body");
            return false;
        }
        return true;
    }

    //// UTIL

    protected replaceVars(str: string): string {
        for (let v in this._options.vars) {
            if (!this._options.vars.hasOwnProperty(v)) continue;
            str = str.replace(new RegExp("\\$" + v + "\\$", "g"), this._options.vars[v]);
        }
        return str;
    }

    protected delay(time: number): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => resolve(), time);
        });
    }

    //// COMMANDS

    async runAllCommands(): Promise<void> {
        if (this._options.logCommands) console.log(TAG + "Running commands!")
        for (let cat of this._options.commandOrder) {
            await this.delay(this._options.delays[cat]);
            await this.runCategoryCommands(cat);
        }
    }

    protected async runCategoryCommands(cat: string/*meow*/): Promise<boolean> {
        if (!this._options.commands.hasOwnProperty(cat)) {
            console.warn(TAG + "Tried to run commands of " + cat + " category, but category does not exist");
            return false;
        }
        for (let cmd of this._options.commands[cat]) {
            await this.runCommand(cmd);
        }
        return true;
    }

    protected async runCommand(cmd: string): Promise<void> {
        cmd = this.replaceVars(cmd);
        if (this._options.logCommands || this._options.dryCommands) console.log(TAG + "RUN " + (this._options.dryCommands ? "(dry) " : "") + cmd);
        if (!this._options.dryCommands) {
            const { stdout, stderr } = await exec(cmd);
            if (this._options.logCommands) {
                console.log(stdout);
                console.warn(stderr);
            }
        }
    }

}
