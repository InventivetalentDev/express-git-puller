import { EventEmitter } from "events";
import { Request, Response, NextFunction, RequestHandler, Application } from "express";
import { PathParams } from "express-serve-static-core";
import { exec } from "child_process";
import { GithubWebhook, WebhookOptions, GithubBody, GithubHeaders } from "@inventivetalent/express-github-webhook";

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

export interface Options extends WebhookOptions {
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
    private readonly webhookHandler: GithubWebhook;

    constructor(options?: Options) {
        super();
        this._options = { ...DEFAULT_OPTIONS, ...options };
        this._options.vars = { ...DEFAULT_OPTIONS.vars, ...options.vars };
        this._options.commands = { ...DEFAULT_OPTIONS.commands, ...options.commands };
        this._options.delays = { ...DEFAULT_OPTIONS.delays, ...options.delays };

        this.webhookHandler = new GithubWebhook(options);
    }

    //// PUBLIC STUFF

    get options(): Options {
        return { ...this._options };
    }

    get middleware(): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
            this.webhookHandler.middleware(req,res, ()=>{
                this.handleRequest(req, res);
            });
        };
    }

    addTo(app: Application, path: PathParams): Application {
        return app.use(path, this.middleware);
    }

    //// REQUEST STUFF

    // OPTION CHECKS

    protected handleRequest(req: Request, res: Response): boolean {
        const body = req.body as GithubBody;
        const headers = req.headers as GithubHeaders;

        if (!this.validateToken(body, headers, req)) {
            res.status(401).send("invalid token");
            console.warn(TAG + "Received webhook request with invalid token");
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

    // VALIDATIONS

    protected validateToken(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        if (!this._options.token || this._options.token.length <= 0) return true; // no token configured
        const token = req.query.token as string;
        if (!token || token.length <= 0) return false;
        // check token
        return token === this._options.token
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

    protected runCommand(cmd: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            cmd = this.replaceVars(cmd);
            if (this._options.logCommands || this._options.dryCommands) console.log(TAG + "RUN " + (this._options.dryCommands ? "(dry) " : "") + cmd);
            if (!this._options.dryCommands) {
                exec(cmd, (err, stdout, stderr) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (this._options.logCommands) {
                        console.log(stdout);
                        console.warn(stderr);
                        resolve();
                    }
                });
            }
        })
    }

}
