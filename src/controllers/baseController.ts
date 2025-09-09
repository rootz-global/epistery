import { Response, Request } from 'express';
export abstract class Controller {
  protected sendResponse(res: Response, data: any, statusCode: number = 200) {
    res.status(statusCode).json(data);
  }

  protected setCookie(res: Response, name: string, data: any) {
    res.cookie(name, JSON.stringify(data));
  }

  protected getCookie(req: Request, name: string): any {
    try {
      return req.cookies[name];
    }
    catch(e) {}
  }

  protected sendError(res: Response, message: string, statusCode: number = 500) {
    res.status(statusCode).json({
      error: message,
      timestamp: new Date().toISOString()
    });
  }
}
