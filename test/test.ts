import { should } from 'chai';
import { Options, Puller } from "../src/Puller";
import { Request, Response, NextFunction, RequestHandler, Application } from "express";
import { PathParams } from "express-serve-static-core";
import { GithubBody, GithubHeaders } from "@inventivetalent/express-github-webhook";

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

    public replaceVars(str: string): any {
        return super.replaceVars(str);
    }

    public delay(time: number): Promise<void> {
        return super.delay(time);
    }

    public validateToken(body: GithubBody, headers: GithubHeaders, req: Request): boolean {
        return super.validateToken(body, headers, req);
    }

}

describe("Vars", function () {
    let puller = new PublicPuller({
        secret: "idunno",
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
