import { RtspRequest } from 'rtsp-server';
import { v4 as uuid } from 'uuid';

import { Client } from './Client';
import { ClientServer } from './ClientServer';
import { Mount } from './Mount';
import { getDebugger, getMountInfo } from './utils';

const debug = getDebugger('ClientWrapper');

export class ClientWrapper {
    id: string;
    mount: Mount;
    clientServer: ClientServer;

    clients: {
        [clientId: string]: Client;
    };

    keepaliveTimeout?: NodeJS.Timeout;
    context: any;

    authorizationHeader: string;

    constructor(clientServer: ClientServer, req: RtspRequest) {
        this.id = uuid();
        this.clientServer = clientServer;
        this.clients = {};
        debug('%s - constructed', this.id);

        const info = getMountInfo(req.uri);
        const mount = clientServer.mounts.mounts[info.path];
        if (!mount) {
            throw new Error('Mount does not exist');
        }

        this.context = (req as any).context || {};

        this.mount = mount;
        this.authorizationHeader = req.headers.authorization || '';
    }

    /**
     *
     * @param mounts
     * @param req
     */
    addClient(req: RtspRequest): Client {
        const client = new Client(this.mount, req);

        // Some clients for whatever reason don't send RTSP keepalive requests
        // (Live555 streaming media as an example)
        // RTP spec says compliant clients should be sending rtcp Receive Reports (RR) to show their "liveliness"
        // So we support this as a keepalive too.
        client.rtcpServer.on('message', () => {
            this.keepalive();
        });

        this.clients[client.id] = client;
        debug('%s new client %s', this.id, client.id);
        return client;
    }

    /**
     *
     */
    play(): void {
        for (const client in this.clients) {
            this.clients[client].play();
        }

        this.keepalive();
    }

    /**
     *
     */
    close(): void {
        if (this.keepaliveTimeout) {
            clearTimeout(this.keepaliveTimeout);
        }

        for (const client in this.clients) {
            this.clients[client].close();
        }

        this.clientServer.clientGone(this.id);
    }

    /**
     *
     */
    keepalive(): void {
        if (this.keepaliveTimeout) {
            clearTimeout(this.keepaliveTimeout);
        }

        this.keepaliveTimeout = setTimeout(async () => {
            debug('%s client timeout, closing connection', this.id);
            try {
                await this.close();
            } catch (e) {
                // Ignore
            }
        }, 6e4); // 60 seconds (double the normal keepalive interval)
    }
}
