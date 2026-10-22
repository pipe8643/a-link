import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { CryptoService } from "./crypto.service.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { SessionService } from "./session.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, CryptoService, SessionService, LoginRateLimiter],
  exports: [AuthService, CryptoService, SessionService, LoginRateLimiter],
})
export class AuthModule {}
