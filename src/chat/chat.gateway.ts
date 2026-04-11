import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { BookingsService } from '../bookings/bookings.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private chatService: ChatService,
    private bookingsService: BookingsService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      client.data.userId = payload.sub;
      client.data.userRole = payload.role;

      // Room for real-time quote/booking events (user or mechanic by id)
      client.join(`account:${payload.sub}`);

      // Join booking rooms for chat only when a quote has been accepted (user and mechanic can chat)
      const asUser = await this.bookingsService.findByUserId(payload.sub);
      const asMechanic = payload.role === 'MECHANIC' ? await this.bookingsService.findByMechanicId(payload.sub) : [];
      const chatBookings = [
        ...asUser.filter((b) => b.mechanicId != null && b.status !== 'REQUESTED'),
        ...asMechanic.filter((b) => b.mechanicId != null && b.status !== 'REQUESTED'),
      ];
      chatBookings.forEach((booking) => {
        client.join(`booking:${booking.id}`);
      });
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  // Real-time quote events (emitted by BookingsService via EventEmitter)
  @OnEvent('quote.created')
  handleQuoteCreated(payload: { userId: string; bookingId: string; quote: any }) {
    this.server?.to(`account:${payload.userId}`).emit('quote:created', payload);
  }

  @OnEvent('quote.updated')
  handleQuoteUpdated(payload: { userId: string; bookingId: string; quote: any }) {
    this.server?.to(`account:${payload.userId}`).emit('quote:updated', payload);
  }

  @OnEvent('quote.rejected')
  handleQuoteRejected(payload: { mechanicId: string; bookingId: string; quoteId: string }) {
    this.server?.to(`account:${payload.mechanicId}`).emit('quote:rejected', payload);
  }

  @OnEvent('quote.accepted')
  handleQuoteAccepted(payload: {
    userId: string;
    mechanicId: string;
    bookingId: string;
    quoteId: string;
    booking: any;
  }) {
    this.server?.to(`account:${payload.userId}`).emit('quote:accepted', payload);
    this.server?.to(`account:${payload.mechanicId}`).emit('quote:accepted', payload);
  }

  @SubscribeMessage('join_booking')
  async handleJoinBooking(@ConnectedSocket() client: Socket, @MessageBody() bookingId: string) {
    client.join(`booking:${bookingId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { bookingId: string; receiverId: string; receiverType: string; content: string },
  ) {
    const message = await this.chatService.createMessage(
      data.bookingId,
      client.data.userId,
      data.receiverId,
      client.data.userRole,
      data.receiverType,
      data.content,
    );

    // Emit to all clients in the booking room
    this.server.to(`booking:${data.bookingId}`).emit('new_message', message);

    return message;
  }
}
