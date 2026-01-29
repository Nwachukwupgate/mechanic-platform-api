# Mechanic Platform API

Backend API for the Mechanic Marketplace Platform built with NestJS, PostgreSQL, and Prisma.

## Features

- 🔐 JWT Authentication with email verification
- 👥 User and Mechanic registration and management
- 🚗 Vehicle management
- 🔧 Fault categorization and matching
- 📍 Location-based mechanic matching
- 📅 Booking lifecycle management
- 💬 Real-time chat with Socket.io
- ⭐ Rating and review system
- 🛡️ Role-based access control (USER, MECHANIC, ADMIN)

## Tech Stack

- **Framework**: NestJS
- **Database**: PostgreSQL (Neon)
- **ORM**: Prisma
- **Authentication**: JWT with Passport
- **WebSockets**: Socket.io
- **Email**: Nodemailer
- **Validation**: class-validator, class-transformer

## Prerequisites

- Node.js 18+ 
- PostgreSQL database (Neon recommended)
- npm or yarn

## Installation

1. Clone the repository:
```bash
cd mechanic-platform-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
- `DATABASE_URL`: Your PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `SMTP_*`: Email service configuration (for email verification)

4. Set up the database:
```bash
# Generate Prisma Client
npm run prisma:generate

# Run migrations
npm run prisma:migrate
```

5. Start the development server:
```bash
npm run start:dev
```

The API will be available at `http://localhost:4000`

## API Documentation

Once the server is running, visit `http://localhost:4000/api` for Swagger API documentation.

## Project Structure

```
src/
├── auth/           # Authentication module
├── users/          # User management
├── mechanics/      # Mechanic management
├── profiles/       # Profile management
├── vehicles/       # Vehicle CRUD
├── faults/         # Fault categories
├── bookings/       # Booking lifecycle
├── chat/           # Real-time chat (Socket.io)
├── ratings/        # Rating system
├── location/       # Geolocation utilities
├── notifications/  # Notification service
└── common/         # Shared utilities, guards, decorators
```

## API Endpoints

### Authentication
- `POST /auth/register/user` - Register a new user
- `POST /auth/register/mechanic` - Register a new mechanic
- `POST /auth/login/user` - Login as user
- `POST /auth/login/mechanic` - Login as mechanic
- `GET /auth/verify-email` - Verify email address
- `GET /auth/me` - Get current user (protected)

### Users
- `GET /users/me` - Get current user profile
- `PUT /users/me/profile` - Update user profile

### Mechanics
- `GET /mechanics` - List all mechanics
- `GET /mechanics/:id` - Get mechanic details
- `GET /mechanics/me/profile` - Get current mechanic profile (mechanic only)
- `PUT /mechanics/me/profile` - Update mechanic profile (mechanic only)
- `PUT /mechanics/me/availability` - Update availability (mechanic only)

### Vehicles
- `POST /vehicles` - Add a vehicle
- `GET /vehicles` - List user's vehicles
- `GET /vehicles/:id` - Get vehicle details
- `PUT /vehicles/:id` - Update vehicle
- `DELETE /vehicles/:id` - Delete vehicle

### Faults
- `GET /faults` - List all faults
- `GET /faults?category=ENGINE` - Filter by category
- `GET /faults/:id` - Get fault details

### Bookings
- `POST /bookings` - Create a booking
- `GET /bookings` - List user/mechanic bookings
- `GET /bookings/:id` - Get booking details
- `GET /bookings/nearby-mechanics` - Find nearby mechanics
- `PUT /bookings/:id/accept` - Accept booking (mechanic only)
- `PUT /bookings/:id/status` - Update booking status
- `PUT /bookings/:id/cost` - Update cost estimate (mechanic only)

### Ratings
- `POST /ratings` - Create a rating (user only)
- `GET /ratings/mechanic/:mechanicId` - Get mechanic ratings
- `GET /ratings/mechanic/:mechanicId/average` - Get average rating

## Booking Status Flow

```
REQUESTED → ACCEPTED → IN_PROGRESS → DONE → PAID → DELIVERED
```

## Environment Variables

See `.env.example` for all required environment variables.

## Development

```bash
# Development mode with hot reload
npm run start:dev

# Build for production
npm run build

# Start production server
npm run start:prod

# Run tests
npm test

# Run Prisma Studio (database GUI)
npm run prisma:studio
```

## License

MIT
