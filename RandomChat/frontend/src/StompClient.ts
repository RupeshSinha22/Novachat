export type ChatMessage = {
  id?: string;
  content: string;
  senderId: string;
  senderNickname?: string;
  type: 'CHAT' | 'JOIN' | 'LEAVE' | 'MATCHED' | 'DISCONNECTED' | 'TYPING' | 'SYSTEM' | 'READ';
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  roomName?: string;
  timestamp?: string;
  // matchmaking-only
  interests?: string;
  genderFilter?: string;
  gender?: string;
  isPremium?: boolean;
};

import { Client, IMessage } from '@stomp/stompjs';

export class ChatService {
  private stompClient: Client;
  private userId: string;
  private onMessageReceived: (msg: ChatMessage) => void;
  private onMatchReceived: (msg: ChatMessage) => void;

  constructor(
    userId: string,
    onMessage: (msg: ChatMessage) => void,
    onMatch: (msg: ChatMessage) => void,
    nickname?: string,
    dmTargetUserId?: string,
    interests?: string,
    genderFilter?: string,
    gender?: string,
    isPremium?: boolean,
    rejoinRoom?: string // room name to rejoin after page refresh
  ) {
    this.userId = userId;
    this.onMessageReceived = onMessage;
    this.onMatchReceived = onMatch;

    this.stompClient = new Client({
      brokerURL: import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws',
      reconnectDelay: 3000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      debug: (str) => {
        console.log('[STOMP]', str);
      },
      onStompError: (frame) => {
        console.error('[STOMP ERROR]', frame.headers['message'], frame.body);
      },
      onWebSocketError: (evt) => {
        console.error('[WS ERROR]', evt);
      },
      onWebSocketClose: (evt) => {
        console.warn('[WS CLOSE]', evt);
      },
    });

    this.stompClient.onConnect = () => {
      console.log('[STOMP] Connected successfully! Subscribing...');
      this.stompClient.subscribe(`/queue/user/${this.userId}/match`, (message: IMessage) => {
        const body = JSON.parse(message.body) as ChatMessage;
        this.onMatchReceived(body);
      });

      this.stompClient.subscribe(`/queue/user/${this.userId}/messages`, (message: IMessage) => {
        const body = JSON.parse(message.body) as ChatMessage;
        this.onMessageReceived(body);
      });

      if (rejoinRoom) {
        // Rejoin existing room after page refresh
        console.log('[STOMP] Rejoining room:', rejoinRoom);
        this.stompClient.publish({
          destination: '/app/chat.rejoin',
          body: JSON.stringify({
            senderId: this.userId,
            senderNickname: nickname || this.userId,
            roomName: rejoinRoom,
          })
        });
      } else if (dmTargetUserId) {
        // Direct message mode — join a DM room with a specific friend
        this.stompClient.publish({
          destination: '/app/chat.dm',
          body: JSON.stringify({ type: 'JOIN', senderId: this.userId, senderNickname: nickname || this.userId, content: dmTargetUserId })
        });
      } else {
        // Global matchmaking mode — include interests + gender for smart matching
        this.stompClient.publish({
          destination: '/app/chat.join',
          body: JSON.stringify({
            type: 'JOIN',
            senderId: this.userId,
            senderNickname: nickname || this.userId,
            content: '',
            interests: interests || '',
            genderFilter: genderFilter || 'ANY',
            gender: gender || '',
            isPremium: isPremium || false,
          })
        });
      }
    };
  }

  public connect() { this.stompClient.activate(); }

  public disconnect() {
    if (this.stompClient.connected) {
      this.stompClient.publish({
        destination: '/app/chat.leave',
        body: JSON.stringify({ type: 'LEAVE', senderId: this.userId, content: '' })
      });
      // Delay deactivation to ensure the leave message reaches the server
      setTimeout(() => {
        try { this.stompClient.deactivate(); } catch (_) { }
      }, 300);
    }
  }

  public send(msg: ChatMessage) {
    if (!this.stompClient.connected) return;
    if (msg.type === 'CHAT' || msg.type === 'TYPING' || msg.type === 'READ') {
      this.stompClient.publish({ destination: '/app/chat.send', body: JSON.stringify(msg) });
    }
  }

  public sendDm(targetUserId: string, nickname?: string) {
    if (!this.stompClient.connected) return;
    this.stompClient.publish({
      destination: '/app/chat.dm',
      body: JSON.stringify({
        type: 'JOIN',
        senderId: this.userId,
        senderNickname: nickname || this.userId,
        content: targetUserId,
      }),
    });
  }
}
