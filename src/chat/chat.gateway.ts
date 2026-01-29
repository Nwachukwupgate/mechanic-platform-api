import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { BookingsService } from '../bookings/bookings.service';
import { UseGuards } from '@nestjs/common';
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

      // Join booking rooms
      const bookings = await this.bookingsService.findByUserId(payload.sub);
      bookings.forEach((booking) => {
        client.join(`booking:${booking.id}`);
      });
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
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
