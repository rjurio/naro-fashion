import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
import { QueryProductsDto } from '../../products/dto/query-products.dto';
import { AiSecured } from '../common/ai-controller.decorators';
import {
  AI_PERMISSION_CODES,
  RequiresAiPermission,
} from '../decorators/requires-ai-permission.decorator';
import {
  AI_RISK_LEVEL,
  RequiresApproval,
} from '../decorators/requires-approval.decorator';
import { AiToolRunner } from '../services/ai-tool-runner.service';
import { ApprovalService } from '../services/approval.service';
import { CreateProductDraftAiDto } from '../dto/create-product-draft.ai.dto';

/**
 * AI tools for the products module.
 *
 * Phase 1: read-only (search, getOne).
 * Phase 2: draft creation (POST /draft — no approval needed).
 * Phase 3.1A: publish_product is the ONLY risky write wired so far —
 *   POST /:id/publish/request-approval initiates the workflow; the
 *   actual flip to `isActive=true` happens via the consume path on
 *   `ApprovalsAiController`. No direct publish route exists — by design.
 *
 * No other risky tools (update, archive, restore, status changes,
 * inventory, rental policy, permanent delete, refunds) are present yet.
 * The Phase 3 controller shape spec enforces this at build time.
 */
@AiSecured()
@Controller('ai/products')
export class ProductsAiController {
  constructor(
    private readonly products: ProductsService,
    private readonly approvals: ApprovalService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/products/search
  @RequiresAiPermission(AI_PERMISSION_CODES.READ)
  @Get('search')
  search(@Query() query: QueryProductsDto) {
    return this.runner.run({
      tool: 'search_products',
      actionType: 'READ',
      input: query,
      targetResourceType: 'Product',
      handler: () => this.products.findAllAdmin(query),
      message: (data: any) =>
        `Found ${data?.meta?.total ?? 0} product(s) (page ${data?.meta?.page ?? 1}/${data?.meta?.totalPages ?? 1}).`,
    });
  }

  // GET /api/v1/ai/products/:id
  @RequiresAiPermission(AI_PERMISSION_CODES.READ)
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.runner.run({
      tool: 'get_product',
      actionType: 'READ',
      input: { id },
      targetResourceType: 'Product',
      targetResourceId: id,
      handler: () => this.products.findById(id),
    });
  }

  // POST /api/v1/ai/products/draft  (Phase 2 — draft creation, no approval)
  //
  // Creates a Product with isActive: false. Pricing fields are forbidden by
  // the AI DTO (basePrice/compareAtPrice/rentalPricePerDay/etc. → 400). The
  // server forces price: 0 as a placeholder; operators MUST set the real
  // price + add at least one ProductVariant in the admin UI before publish.
  @RequiresAiPermission(AI_PERMISSION_CODES.WRITE_DRAFTS)
  @Post('draft')
  createDraft(@Body() dto: CreateProductDraftAiDto) {
    return this.runner.run({
      tool: 'create_product_draft',
      actionType: 'CREATE',
      input: dto,
      targetResourceType: 'Product',
      handler: async () => {
        // Construct a payload satisfying ProductsService's CreateProductDto.
        // Pricing forced to 0; published forced to false. The DTO whitelist
        // already rejected anything pricing-related on the wire.
        const payload: any = {
          name: dto.name,
          nameSwahili: dto.nameSwahili,
          slug: dto.slug,
          description: dto.description ?? '',
          descriptionSwahili: dto.descriptionSwahili,
          categoryId: dto.categoryId,
          availabilityMode: dto.availabilityMode,
          sku: dto.sku,
          minimumStock: dto.minimumStock,
          supplierName: dto.supplierName,
          supplierContact: dto.supplierContact,
          minRentalDays: dto.minRentalDays,
          maxRentalDays: dto.maxRentalDays,
          bufferDaysOverride: dto.bufferDaysOverride,
          price: 0, // placeholder; operator must update before publishing
          published: false, // forced — drafts are never live
          isFeatured: false,
        };
        return this.products.create(payload);
      },
      message: (data: any) =>
        `Drafted product '${data?.name ?? '?'}' (id ${data?.id ?? '?'}, isActive=false). Set price + add at least one variant in the admin UI before publishing.`,
    });
  }

  // POST /api/v1/ai/products/:id/publish/request-approval  (Phase 3.1A)
  //
  // Opens an approval request to flip `isActive` from false → true. No
  // direct publish endpoint exists — by design. The actual write happens
  // when a different admin approves AND the initiator re-posts the raw
  // token via POST /api/v1/ai/approvals/:approvalId/execute.
  //
  // The @RequiresApproval decorator is recorded as route metadata for
  // forensics + Phase 4 interceptor support, but Phase 3.1A doesn't read
  // it at runtime (the explicit request-approval split makes it
  // redundant). Kept on the route so the shape spec sees consistent
  // metadata across all approval-gated tools.
  @RequiresAiPermission(AI_PERMISSION_CODES.WRITE_DRAFTS)
  @RequiresApproval(AI_RISK_LEVEL.HIGH)
  @Post(':id/publish/request-approval')
  requestPublish(@Param('id') id: string) {
    return this.runner.run({
      tool: 'publish_product',
      actionType: 'APPROVAL_REQUESTED',
      input: { productId: id },
      targetResourceType: 'Product',
      targetResourceId: id,
      handler: () => this.approvals.requestPublishProduct(id),
      message: () =>
        'Approval requested. A different admin must approve before publishing.',
    });
  }
}
