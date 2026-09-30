import { Logger } from '@nestjs/common';
import { OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'ws';
import * as WebSocket from 'ws';
import { AuthService } from '../components/auth/auth.service';
import { Member } from '../libs/dto/member/member';
import * as url from 'url';

interface MessagePayload {
  event: string;
  text: string;
  memberData: Member | null;
}

interface InfoPayload {
  event: string;
  totalClients: number;
  memberData: Member | null;
  action: string;
}

@WebSocketGateway({ transports: ['websocket'], secure: false })
export class SocketGateway implements OnGatewayInit {
  private logger: Logger = new Logger('SocketEventsGateAway');
  private summaryClient: number = 0;
  private clientsAuthMap = new Map<WebSocket, Member | null>();
  private messageList: MessagePayload[] = [];

  constructor(private authService: AuthService) { }

  @WebSocketServer()
  server: Server;

  public afterInit(server: Server) {
    this.logger.verbose(`WebSocket Server Initialized & initial total ['${this.summaryClient}']!`);
  }

  private async retrieveAuth(req: any): Promise<Member | null> {
    try {
      const parseUrl = url.parse(req.url, true);
      const { token } = parseUrl.query;

      console.log('Token =>', token);

      return await this.authService.verifyToken(token as string);
    } catch (err) {
      return null;
    }
  }

  public async handleConnection(client: WebSocket, req: any) {
    const authMember = await this.retrieveAuth(req);
    this.summaryClient++;

    this.clientsAuthMap.set(client, authMember);

    const clientNick: string = authMember?.memberNick ?? 'Guest';
    this.logger.verbose(`Connected [${clientNick}] & total ['${this.summaryClient}']!`);

    const infoMsg: InfoPayload = {
      event: 'info',
      totalClients: this.summaryClient,
      memberData: authMember,
      action: 'joined',
    };

    this.emitMessage(infoMsg);

    client.send(JSON.stringify({ event: 'getMessages', list: this.messageList }));
  }

  public handleDisconnect(client: WebSocket) {
    const authMember = this.clientsAuthMap.get(client) ?? null;
    this.summaryClient--;
    this.clientsAuthMap.delete(client);

    const clientNick: string = authMember?.memberNick ?? 'Guest';
    this.logger.verbose(`Disconnected [${clientNick}] & total ['${this.summaryClient}']!`);

    const infoMsg: InfoPayload = {
      event: 'info',
      totalClients: this.summaryClient,
      memberData: authMember,
      action: 'left',
    };

    this.broadcastMessage(client, infoMsg);
  }

  @SubscribeMessage('message')
  public async handleMessage(client: any, payload: any): Promise<void> {
    const authMember = this.clientsAuthMap.get(client) ?? null;
    const newMessage: MessagePayload = {
      event: 'message',
      text: payload,
      memberData: authMember,
    };

    const clientNick: string = authMember?.memberNick ?? 'Guest';
    this.logger.verbose(`NEW MESSAGE [${clientNick}]: ${payload}`);

    this.messageList.push(newMessage);

    if (this.messageList.length > 5) {
      this.messageList.splice(0, this.messageList.length - 5);
    }

    this.emitMessage(newMessage);
  }

  private broadcastMessage(sender: WebSocket, message: InfoPayload | MessagePayload) {
    this.server.clients.forEach((client) => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  private emitMessage(message: InfoPayload | MessagePayload) {
    this.server.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}
