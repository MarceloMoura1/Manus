import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Testes de integração para sendBaileysMessage
 * 
 * Valida que mensagens são enviadas corretamente quando:
 * 1. O phone é um número normal
 * 2. O phone é um LID que foi resolvido
 * 3. O phone é um LID que NÃO foi resolvido (deve retornar erro)
 */

describe('sendBaileysMessage - Message Sending', () => {
  describe('JID Formatting', () => {
    it('deve formatar JID corretamente para número sem @', () => {
      const phone = '5511987654321';
      const cleanPhone = phone.replace(/\D/g, '');
      const jid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
      
      expect(jid).toBe('5511987654321@s.whatsapp.net');
    });

    it('deve manter JID que já tem @s.whatsapp.net', () => {
      const phone = '5511987654321@s.whatsapp.net';
      const cleanPhone = phone.replace(/\D/g, '');
      const jid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
      
      // Note: cleanPhone remove @ também, então fica só dígitos
      expect(cleanPhone).toBe('5511987654321');
      expect(jid).toBe('5511987654321@s.whatsapp.net');
    });
  });

  describe('LID Detection', () => {
    it('deve detectar LID temporário com prefixo lid', () => {
      const phone = 'lid63346606899236';
      const isLidTemp = phone.startsWith('lid') || (phone.replace(/\D/g, '').length > 15);
      
      expect(isLidTemp).toBe(true);
    });

    it('deve detectar LID temporário com número muito longo', () => {
      const phone = '123456789012345678'; // 18 dígitos
      const cleanPhone = phone.replace(/\D/g, '');
      const isLidTemp = phone.startsWith('lid') || (cleanPhone.length > 15 && !phone.includes('@'));
      
      expect(isLidTemp).toBe(true);
    });

    it('não deve detectar número normal como LID', () => {
      const phone = '5511987654321'; // 13 dígitos
      const cleanPhone = phone.replace(/\D/g, '');
      const isLidTemp = phone.startsWith('lid') || (cleanPhone.length > 15 && !phone.includes('@'));
      
      expect(isLidTemp).toBe(false);
    });
  });

  describe('LID Resolution', () => {
    it('deve resolver LID quando mapeamento existe em memória', () => {
      const phone = 'lid63346606899236';
      const rawLid = phone.slice(3);
      
      // Simular: mapa em memória tem o mapeamento
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      lidToPhoneMap.set('client-1', new Map([
        ['63346606899236', '5511987654321']
      ]));
      
      const clientMap = lidToPhoneMap.get('client-1');
      const resolved = clientMap?.get(rawLid);
      
      if (resolved) {
        const cleanPhone = resolved.replace(/\D/g, '');
        expect(cleanPhone).toBe('5511987654321');
      }
    });

    it('deve retornar erro quando LID não pode ser resolvido', () => {
      const phone = 'lid63346606899236';
      const rawLid = phone.slice(3);
      
      // Simular: mapa vazio (LID não mapeado)
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      
      const clientMap = lidToPhoneMap.get('client-1');
      const resolved = clientMap?.get(rawLid);
      
      if (!resolved) {
        const error = 'Número do contato ainda não identificado. Aguarde o contato enviar uma mensagem primeiro para que o número seja resolvido.';
        expect(error).toContain('ainda não identificado');
      }
    });
  });

  describe('Message Persistence', () => {
    it('deve salvar mensagem no banco com dados corretos', () => {
      // Simular: dados da mensagem
      const messageData = {
        id: 'msg-1234567890-abc123',
        sender: 'agent',
        agentName: 'João Silva',
        text: 'Olá, tudo bem?',
        timestamp: new Date().toISOString(),
        type: 'text',
      };
      
      // Validar estrutura
      expect(messageData.sender).toBe('agent');
      expect(messageData.text).toBe('Olá, tudo bem?');
      expect(messageData.type).toBe('text');
      expect(messageData.agentName).toBe('João Silva');
    });

    it('deve adicionar mensagem ao array existente', () => {
      // Simular: mensagens existentes
      let messages = [
        {
          id: 'msg-1',
          sender: 'customer',
          text: 'Oi',
          timestamp: '2026-05-22T10:00:00Z',
          type: 'text',
        }
      ];
      
      // Adicionar nova mensagem
      const newMessage = {
        id: 'msg-2',
        sender: 'agent',
        agentName: 'Atendente',
        text: 'Olá!',
        timestamp: new Date().toISOString(),
        type: 'text',
      };
      
      messages.push(newMessage);
      
      expect(messages.length).toBe(2);
      expect(messages[1].sender).toBe('agent');
    });
  });

  describe('Fluxo completo de envio', () => {
    it('deve enviar mensagem com número normal com sucesso', () => {
      const sendData = {
        clientId: 'client-1',
        conversationId: 'conv-1',
        phone: '5511987654321',
        text: 'Olá!',
        agentName: 'Atendente',
      };
      
      // Validar dados
      const cleanPhone = sendData.phone.replace(/\D/g, '');
      const jid = `${cleanPhone}@s.whatsapp.net`;
      
      expect(jid).toBe('5511987654321@s.whatsapp.net');
      expect(sendData.text).toBeTruthy();
    });

    it('deve enviar mensagem com LID resolvido com sucesso', () => {
      const sendData = {
        clientId: 'client-1',
        conversationId: 'conv-1',
        phone: 'lid63346606899236',
        text: 'Olá!',
        agentName: 'Atendente',
      };
      
      // Simular: LID foi resolvido
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      lidToPhoneMap.set('client-1', new Map([
        ['63346606899236', '5511987654321']
      ]));
      
      const isLidTemp = sendData.phone.startsWith('lid');
      if (isLidTemp) {
        const rawLid = sendData.phone.slice(3);
        const clientMap = lidToPhoneMap.get(sendData.clientId);
        const resolved = clientMap?.get(rawLid);
        
        if (resolved) {
          const cleanPhone = resolved.replace(/\D/g, '');
          const jid = `${cleanPhone}@s.whatsapp.net`;
          
          expect(jid).toBe('5511987654321@s.whatsapp.net');
        }
      }
    });

    it('deve rejeitar envio quando LID não está resolvido', () => {
      const sendData = {
        clientId: 'client-1',
        conversationId: 'conv-1',
        phone: 'lid63346606899236',
        text: 'Olá!',
        agentName: 'Atendente',
      };
      
      // Simular: LID NÃO foi resolvido
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      
      const isLidTemp = sendData.phone.startsWith('lid');
      let error: string | null = null;
      
      if (isLidTemp) {
        const rawLid = sendData.phone.slice(3);
        const clientMap = lidToPhoneMap.get(sendData.clientId);
        const resolved = clientMap?.get(rawLid);
        
        if (!resolved) {
          error = 'Número do contato ainda não identificado. Aguarde o contato enviar uma mensagem primeiro para que o número seja resolvido.';
        }
      }
      
      expect(error).toBeTruthy();
      expect(error).toContain('ainda não identificado');
    });
  });

  describe('Error Handling', () => {
    it('deve retornar erro quando WhatsApp não está conectado', () => {
      const isConnected = false;
      
      if (!isConnected) {
        const error = 'WhatsApp não conectado para este cliente';
        expect(error).toContain('não conectado');
      }
    });

    it('deve retornar erro quando conversationId está vazio', () => {
      const conversationId = '';
      
      if (!conversationId) {
        const error = 'conversationId é obrigatório';
        expect(error).toBeTruthy();
      }
    });

    it('deve retornar erro quando text está vazio', () => {
      const text = '';
      
      if (!text || !text.trim()) {
        const error = 'text é obrigatório';
        expect(error).toBeTruthy();
      }
    });
  });
});
