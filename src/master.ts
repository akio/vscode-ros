import * as constants from "./constants";
import * as pfs from "./promise-fs";
import * as _ from "underscore";
import * as vscode from "vscode";
import * as xmlrpc from "xmlrpc";

/**
 * Shows the master status in an editor view.
 */
export function showMasterStatus() {
  return vscode.commands.executeCommand(
    "vscode.previewHtml", vscode.Uri.parse("ros-master:"), undefined, "ROS Master"
  );
}

const CALLER_ID = "vscode-ros";

/**
 * Exposes the ROS master XML-RPC api.
 */
export class XmlRpcApi {
  private client: xmlrpc.Client;

  public constructor(uri: string) {
    this.client = xmlrpc.createClient(uri);
  }

  /**
   * Returns true if a master process is running.
   */
  public check(): Promise<boolean> {
    return this.getPid().then(() => true, () => false);
  }

  public getPid(): Promise<number> {
    return this.methodCall("getPid");
  }

  public getSystemState(): Promise<ISystemState> {
    return this.methodCall("getSystemState").then(result => {
      // Transforms from [[a, [b, c, ...]], ...] to { a: [b, c, ...], ... }.
      const transform = (items: any[]) => items.reduce((obj, arr) => {
        obj[arr[0]] = arr[1];
        return obj;
      }, {});

      return {
        publishers: transform(result[0]),
        subscribers: transform(result[1]),
        services: transform(result[2]),
      };
    });
  }

  private methodCall(method: string, ...args: any[]) {
    return new Promise((resolve, reject) => {
      this.client.methodCall(method, [CALLER_ID, ...args], (err, val) => {
        if (err) {
          reject(err);
        } else if (val[0] !== 1) {
          reject(val);
        } else {
          resolve(val[2]);
        }
      });
    });
  }
}

interface ISystemState {
  publishers: { [topic: string]: string[] };
  subscribers: { [topic: string]: string[] };
  services: { [service: string]: string[] };
}

/**
 * Shows the ROS master status in the status bar.
 */
export class StatusBarItem {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timer;
  private status: boolean;

  public constructor(private api: XmlRpcApi) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
    this.item.text = "$(question) ROS master";
    this.item.command = constants.CMD_SHOW_MASTER_STATUS;
  }

  public activate() {
    this.item.show();
    this.timer = setInterval(() => this.update(), 200);
  }

  public dispose() {
    this.item.dispose();
  }

  private async update() {
    const status = await this.api.check();

    if (status === this.status) {
      return;
    }

    this.item.text = (status ? "$(check)" : "$(x)") + " ROS master";
    this.status = status;
  }
}

/**
 * Shows parameters, topics and services in an editor view.
 */
export class StatusDocumentProvider implements vscode.TextDocumentContentProvider {
  public constructor(private context: vscode.ExtensionContext, private api: XmlRpcApi) {
  }

  public async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken) {
    const templateFilename = this.context.asAbsolutePath("templates/master-status.html");
    const template = _.template(await pfs.readFile(templateFilename, "utf-8"));

    let status = await this.api.check();
    let data = <any> { status };

    if (status) {
      const state = await this.api.getSystemState();
      data = { ...data, ...state };
    }

    return template(data);
  }
}
