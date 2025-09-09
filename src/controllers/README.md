# Controllers Directory

This directory contains controller files for organizing route handlers.

## Structure
- `baseController.ts` - Base controller class with common functionality
- Add your route controllers here following the pattern:
  - Import and extend the `Controller` class from `baseController.ts`
  - Implement route handler methods
  - Export the controller for use in your routes

## Example Controller
```typescript
import { Request, Response } from 'express';
import { Controller } from './baseController';

export class ExampleController extends Controller {
  public index(req: Request, res: Response) {
    this.sendResponse(res, { message: 'Hello from controller!' });
  }
}
```