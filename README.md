# ClothingCo API

A robust e-commerce REST API built with NestJS, Prisma, PostgreSQL, JWT authentication, role-based authorization, cart management, stock reservation, and order processing.

This project was built as part of my backend learning journey and focuses heavily on data integrity, concurrency management, secure authentication flows, and modular scalability.

---

# Features

## Authentication

- JWT authentication
- Access + refresh token flow
- Email verification
- Forgot/reset password
- Role-based authorization
- Protected routes with guards

## Users

- User profile management
- Admin user management
- Soft delete users
- Role system (`USER`, `ADMIN`, `SUPERADMIN`)

## Products

- Product CRUD
- Product variants
- SKU generation
- Slug generation
- Product filtering
- Pagination
- Sorting
- Search
- Redis-style cache layer using Nest cache manager

## Categories

- Category CRUD
- Admin-only management

## Cart

- Add/remove/update cart items
- Guest cart merge
- Stock-aware cart validation
- Transaction-safe cart operations

## Orders

- Create orders from cart
- Stock reservation system
- Reservation expiration handling
- Order confirmation/cancellation
- Pagination
- Transaction-safe stock updates

## Infrastructure

- Prisma ORM
- PostgreSQL
- Global exception handling
- Structured logging
- DTO validation
- Modular NestJS architecture

---

# Tech Stack

- NestJS
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT
- bcrypt
- MailerSend
- class-validator
- class-transformer
- cache-manager

---

# Project Structure

```txt
src/
├── auth/
├── cart/
├── categories/
├── common/
├── database/
├── email/
├── logger/
├── orders/
├── products/
├── users/
└── main.ts
```

# API Overview

## Authentication

| Method | Endpoint                    | Description            |
| ------ | --------------------------- | ---------------------- |
| POST   | `/auth/register`            | Register user          |
| POST   | `/auth/login`               | Login                  |
| POST   | `/auth/logout`              | Logout                 |
| POST   | `/auth/forgot-password`     | Request password reset |
| POST   | `/auth/reset-password`      | Reset password         |
| GET    | `/auth/verify-email`        | Verify email           |
| POST   | `/auth/resend-verification` | Resend verification    |
| POST   | `/auth/refresh`             | Refresh access token   |

---

## Products

| Method | Endpoint          | Description    |
| ------ | ----------------- | -------------- |
| GET    | `/products`       | List products  |
| GET    | `/products/:slug` | Get product    |
| POST   | `/products`       | Create product |
| PATCH  | `/products/:slug` | Update product |
| DELETE | `/products/:slug` | Delete product |

---

## Product Variants

| Method | Endpoint                        | Description    |
| ------ | ------------------------------- | -------------- |
| GET    | `/products/variants/:sku`       | Get variant    |
| POST   | `/products/:slug/variants`      | Add variant    |
| PATCH  | `/products/:slug/variants/:sku` | Update variant |
| DELETE | `/products/:slug/variants/:sku` | Delete variant |

---

## Categories

| Method | Endpoint          | Description     |
| ------ | ----------------- | --------------- |
| GET    | `/categories`     | List categories |
| GET    | `/categories/:id` | Get category    |
| POST   | `/categories`     | Create category |
| PATCH  | `/categories/:id` | Update category |
| DELETE | `/categories/:id` | Delete category |

---

## Cart

| Method | Endpoint            | Description      |
| ------ | ------------------- | ---------------- |
| GET    | `/cart`             | Get cart         |
| POST   | `/cart/add`         | Add item         |
| PATCH  | `/cart/update`      | Update quantity  |
| DELETE | `/cart/remove/:sku` | Remove item      |
| POST   | `/cart/merge`       | Merge guest cart |
| DELETE | `/cart/clear`       | Clear cart       |

---

## Orders

| Method | Endpoint                   | Description            |
| ------ | -------------------------- | ---------------------- |
| POST   | `/orders`                  | Create order           |
| GET    | `/orders/me`               | Get user orders        |
| GET    | `/orders`                  | Get all orders (admin) |
| GET    | `/orders/:orderId`         | Get order              |
| PATCH  | `/orders/:orderId/cancel`  | Cancel order           |
| PATCH  | `/orders/:orderId/confirm` | Confirm payment        |

---

## Users

| Method | Endpoint     | Description        |
| ------ | ------------ | ------------------ |
| GET    | `/users/me`  | Get own profile    |
| PATCH  | `/users/me`  | Update own profile |
| GET    | `/users`     | Get all users      |
| PATCH  | `/users/:id` | Admin update user  |
| DELETE | `/users/:id` | Delete user        |

---

# Highlights

## Transactional Stock Reservation

Orders reserve stock before payment confirmation to prevent overselling.

Reservation logic includes:

- Retry mechanisms
- Expiration handling
- Idempotent confirmation
- Atomic Prisma transactions

---

## Caching

Products and variants use cache-manager for response caching.

Cache invalidation uses internal cache versioning.

---

## Validation & Error Handling

- DTO validation with class-validator
- Global exception filter
- Prisma error handling
- Structured logger service

---

# Future Improvements

- Stripe integration
- Docker support
- Unit & e2e testing
- Advanced filtering/search
- Redis distributed cache

---

# Author

Built by Alberto Ribeiro

Backend project built while learning modern backend engineering with NestJS and Prisma.
