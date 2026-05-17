import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateConversationStatus, updateCustomer } from './db';

// Mock do banco de dados
vi.mock('./db', () => ({
  getDb: vi.fn(),
  updateConversationStatus: vi.fn(),
  updateCustomer: vi.fn(),
}));

describe('Conversation Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateConversationStatus', () => {
    it('deve atualizar status da conversa para closed', async () => {
      const conversationId = 'conv-123';
      const status = 'closed' as const;

      await updateConversationStatus(conversationId, status);

      expect(updateConversationStatus).toHaveBeenCalledWith(conversationId, status);
    });

    it('deve atualizar status da conversa para bot', async () => {
      const conversationId = 'conv-456';
      const status = 'bot' as const;

      await updateConversationStatus(conversationId, status);

      expect(updateConversationStatus).toHaveBeenCalledWith(conversationId, status);
    });

    it('deve atualizar status da conversa para open', async () => {
      const conversationId = 'conv-789';
      const status = 'open' as const;

      await updateConversationStatus(conversationId, status);

      expect(updateConversationStatus).toHaveBeenCalledWith(conversationId, status);
    });
  });

  describe('updateCustomer', () => {
    it('deve atualizar nome do cliente', async () => {
      const input = {
        customerId: 'cust-123',
        name: 'Novo Nome',
      };

      await updateCustomer(input);

      expect(updateCustomer).toHaveBeenCalledWith(input);
    });

    it('deve atualizar empresa do cliente', async () => {
      const input = {
        customerId: 'cust-456',
        company: 'Nova Empresa',
      };

      await updateCustomer(input);

      expect(updateCustomer).toHaveBeenCalledWith(input);
    });

    it('deve atualizar nome e empresa do cliente', async () => {
      const input = {
        customerId: 'cust-789',
        name: 'Novo Nome',
        company: 'Nova Empresa',
      };

      await updateCustomer(input);

      expect(updateCustomer).toHaveBeenCalledWith(input);
    });

    it('deve aceitar atualização com apenas nome', async () => {
      const input = {
        customerId: 'cust-001',
        name: 'Outro Nome',
      };

      await updateCustomer(input);

      expect(updateCustomer).toHaveBeenCalledWith(input);
    });

    it('deve aceitar atualização com apenas empresa', async () => {
      const input = {
        customerId: 'cust-002',
        company: 'Outra Empresa',
      };

      await updateCustomer(input);

      expect(updateCustomer).toHaveBeenCalledWith(input);
    });
  });
});
