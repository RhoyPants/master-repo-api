export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        name: string;
        role: string;
        userType: string;
        authType: string;
      };
    }
  }
}
