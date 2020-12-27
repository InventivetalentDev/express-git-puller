import { should } from 'chai';
import { Options, Puller } from "../src/Puller";
import { Request, Response, NextFunction, RequestHandler, Application } from "express";
import { PathParams } from "express-serve-static-core";
import { GithubBody, GithubHeaders } from "../src/Github";

should();

class PublicPuller extends Puller {

    constructor(options: Options) {
        super(options);
    }

    addTo(app: Application, path: PathParams): Application {
        return super.addTo(app, path);
    }

    public handleRequest(req: Request, res: Response): boolean {
        return super.handleRequest(req, res);
    }

    public validateRequest(req: Request, res: Response): boolean {
        return super.validateRequest(req, res);
    }

    public replaceVars(str: string): any {
        return super.replaceVars(str);
    }

    public delay(time: number): Promise<void> {
        return super.delay(time);
    }

    public shouldHandleEvent(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.shouldHandleEvent(body, headers, req);
    }

    public shouldHandleRef(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.shouldHandleRef(body, headers, req);
    }

    public shouldHandlePusher(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.shouldHandlePusher(body, headers, req);
    }

    public shouldHandleCommit(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.shouldHandleCommit(body, headers, req);
    }

    public validateToken(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.validateToken(body, headers, req);
    }

    public validateSignature(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.validateSignature(body, headers, req);
    }
}

describe("Vars", function () {
    let puller = new PublicPuller({
        vars: {
            avar: "idk",
            bvar: "idunno"
        }
    });
    it("should replace vars", function () {
        puller.replaceVars("some $avar$ command").should.equal("some idk command");
        puller.replaceVars("more $avar$$bvar$ commands").should.equal("more idkidunno commands");
    });
});

describe("Checks", function () {
    let puller = new PublicPuller({
        events: ["push"],
        branches: ["main"],
        onlyTags: true,
    });
    describe("#events", function () {
        it("should handle only 'push' events", function () {
            puller.shouldHandleEvent({} as GithubBody, {
                "x-github-event": "push"
            } as GithubHeaders, {
                headers: {
                    'x-github-event': 'push'
                }
            } as unknown as Request).should.be.true;

            puller.shouldHandleEvent({} as GithubBody, {
                "x-github-event": "create"
            } as GithubHeaders, {
                headers: {
                    'x-github-event': 'create'
                }
            } as unknown as Request).should.be.false;
        });
    });
    describe("#refs", function () {
        it("should only handle tagged commits on 'main' branch", function () {
            puller.shouldHandleRef({
                base_ref: 'refs/heads/main',
                ref: 'refs/tags/some_tag'
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    base_ref: 'refs/heads/main',
                    ref: 'refs/tags/some_tag'
                }
            } as unknown as Request).should.be.true;

            puller.shouldHandleRef({
                base_ref: 'refs/heads/master',
                ref: 'refs/tags/some_tag'
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    base_ref: 'refs/heads/master',
                    ref: 'refs/tags/some_tag'
                }
            } as unknown as Request).should.be.false;

            puller.shouldHandleRef({
                ref: 'refs/heads/master'
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    ref: 'refs/heads/master'
                }
            } as unknown as Request).should.be.false;

            puller.shouldHandleRef({
                ref: 'refs/heads/main'
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    ref: 'refs/heads/main'
                }
            } as unknown as Request).should.be.false;
        });
    });
    describe("#pushers", function () {
        it("should ignore commits with '[bot]' in the pusher's name", function () {
            puller.shouldHandlePusher({
                pusher: {
                    name: "me!"
                }
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    pusher: {
                        name: "me!"
                    }
                }
            } as unknown as Request).should.be.true;

            puller.shouldHandlePusher({
                pusher: {
                    name: "[bot] idk"
                }
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    pusher: {
                        name: "[bot] idk"
                    }
                }
            } as unknown as Request).should.be.false;
        });
    });
    describe("#commits", function () {
        it("should ignore commits with '[nopull]' in commit message", function () {
            puller.shouldHandleCommit({
                commits: [],
                head_commit: {
                    message: "hi!"
                }
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    commits: [],
                    head_commit: {
                        message: "hi!"
                    }
                }
            } as unknown as Request).should.be.true;

            puller.shouldHandleCommit({
                commits: [],
                head_commit: {
                    message: "[nopull] don't pull me pls"
                }
            } as GithubBody, {} as GithubHeaders, {
                body: {
                    commits: [],
                    head_commit: {
                        message: "[nopull] don't pull me pls"
                    }
                }
            } as unknown as Request).should.be.false;
        });
    });
});
