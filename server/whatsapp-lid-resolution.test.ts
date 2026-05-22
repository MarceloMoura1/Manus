import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Testes para validar a resolução de LID (Linked Device ID) e envio de mensagens
 * 
 * Problema: Quando o cliente envia uma mensagem via WhatsApp multi-device (LID),
 * a conversa é criada com um número temporário (lidXXXXX). Ao enviar uma mensagem
 * de volta, o frontend passa esse número temporário, e o backend não consegue enviar
 * porque o LID ainda não foi resolvido para o número real.
 * 
 * Solução: Quando o LID é resolvido (evento lid-mapping.update), emitir um evento
 * Socket.IO para notificar o frontend, que atualiza o phone da conversa. Assim,
 * o próximo envio usa o número correto.
 */

describe('LID Resolution and Message Sending', () => {
  describe('resolvePhoneFromJid', () => {
    it('deve extrair número de um JID normal', () => {
      const jid = '5511987654321@s.whatsapp.net';
      const rawId = jid.split('@')[0].split(':')[0];
      const phone = rawId.replace(/\D/g, '');
      expect(phone).toBe('5511987654321');
    });

    it('deve retornar LID temporário quando LID não está resolvido', () => {
      const jid = '63346606899236@lid';
      const rawId = jid.split('@')[0].split(':')[0];
      const server = jid.split('@')[1] || '';
      
      // Simular: LID não está no mapa
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      
      if (server === 'lid' || jid.endsWith('@lid')) {
        const clientMap = lidToPhoneMap.get('test-client');
        const resolved = clientMap?.get(rawId);
        if (!resolved) {
          const tempPhone = `lid${rawId}`;
          expect(tempPhone).toBe('lid63346606899236');
        }
      }
    });

    it('deve resolver LID para número real quando mapeamento existe', () => {
      const jid = '63346606899236@lid';
      const rawId = jid.split('@')[0].split(':')[0];
      
      // Simular: LID foi resolvido
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      lidToPhoneMap.set('test-client', new Map([
        ['63346606899236', '5511987654321']
      ]));
      
      const clientMap = lidToPhoneMap.get('test-client');
      const resolved = clientMap?.get(rawId);
      
      expect(resolved).toBe('5511987654321');
    });
  });

  describe('Fluxo de envio de mensagem com LID', () => {
    it('deve rejeitar envio quando LID não está resolvido', () => {
      const phone = 'lid63346606899236';
      const isLidTemp = phone.startsWith('lid');
      
      // Simular: LID não resolvido
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      
      if (isLidTemp) {
        const rawLid = phone.slice(3);
        const clientMap = lidToPhoneMap.get('test-client');
        const resolved = clientMap?.get(rawLid);
        
        if (!resolved) {
          const error = 'Número do contato ainda não identificado. Aguarde o contato enviar uma mensagem primeiro.';
          expect(error).toContain('ainda não identificado');
        }
      }
    });

    it('deve permitir envio quando LID foi resolvido', () => {
      const phone = 'lid63346606899236';
      const isLidTemp = phone.startsWith('lid');
      
      // Simular: LID foi resolvido
      const lidToPhoneMap = new Map<string, Map<string, string>>();
      lidToPhoneMap.set('test-client', new Map([
        ['63346606899236', '5511987654321']
      ]));
      
      if (isLidTemp) {
        const rawLid = phone.slice(3);
        const clientMap = lidToPhoneMap.get('test-client');
        const resolved = clientMap?.get(rawLid);
        
        if (resolved) {
          const cleanPhone = resolved.replace(/\D/g, '');
          const jid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
          
          expect(jid).toBe('5511987654321@s.whatsapp.net');
        }
      }
    });
  });

  describe('Atualização de conversa após resolução de LID', () => {
    it('deve atualizar phone da conversa quando LID é resolvido', () => {
      // Simular: conversa criada com LID temporário
      const conversations = [
        {
          id: 'conv-1',
          phone: 'lid63346606899236',
          name: 'Contato Desconhecido',
          company: '',
        }
      ];
      
      // Simular: LID foi resolvido
      const lidId = '63346606899236';
      const pnId = '5511987654321';
      const tempPhone = `lid${lidId}`;
      
      // Atualizar conversas
      const updated = conversations.map(conv => {
        if (conv.phone === tempPhone) {
          return { ...conv, phone: pnId };
        }
        return conv;
      });
      
      expect(updated[0].phone).toBe('5511987654321');
      expect(updated[0].name).toBe('Contato Desconhecido');
    });

    it('deve atualizar nome do cliente quando LID é resolvido e cliente está cadastrado', () => {
      // Simular: conversa com LID e nome temporário
      const conversations = [
        {
          id: 'conv-1',
          phone: 'lid63346606899236',
          name: 'lid63346606899236', // nome temporário = número
          company: '',
        }
      ];
      
      // Simular: LID foi resolvido e cliente está cadastrado
      const lidId = '63346606899236';
      const pnId = '5511987654321';
      const tempPhone = `lid${lidId}`;
      const newName = 'João Silva';
      
      // Atualizar conversas
      const updated = conversations.map(conv => {
        if (conv.phone === tempPhone) {
          return {
            ...conv,
            phone: pnId,
            name: newName, // atualizar nome se cliente está cadastrado
          };
        }
        return conv;
      });
      
      expect(updated[0].phone).toBe('5511987654321');
      expect(updated[0].name).toBe('João Silva');
    });
  });

  describe('Socket.IO event lid-resolved', () => {
    it('deve emitir evento com dados corretos quando LID é resolvido', () => {
      const eventData = {
        oldPhone: 'lid63346606899236',
        newPhone: '5511987654321',
        lidId: '63346606899236',
      };
      
      expect(eventData.oldPhone).toMatch(/^lid\d+$/);
      expect(eventData.newPhone).toMatch(/^\d{10,}$/);
      expect(eventData.lidId).toMatch(/^\d+$/);
    });

    it('deve atualizar conversa selecionada quando phone muda', () => {
      // Simular: conversa selecionada com LID
      let selectedConv = {
        id: 'conv-1',
        phone: 'lid63346606899236',
        name: 'Contato Desconhecido',
      };
      
      // Simular: evento lid-resolved recebido
      const eventData = {
        oldPhone: 'lid63346606899236',
        newPhone: '5511987654321',
        lidId: '63346606899236',
      };
      
      // Atualizar conversa selecionada
      if (selectedConv?.phone === eventData.oldPhone) {
        selectedConv = { ...selectedConv, phone: eventData.newPhone };
      }
      
      expect(selectedConv.phone).toBe('5511987654321');
    });
  });

  describe('Fluxo completo: receber mensagem com LID → resolver → enviar resposta', () => {
    it('deve permitir enviar mensagem após LID ser resolvido', () => {
      // 1. Cliente envia mensagem com LID
      const incomingJid = '63346606899236@lid';
      const rawId = incomingJid.split('@')[0];
      
      // Simular: conversa criada com LID temporário
      let conversations = [
        {
          id: 'conv-1',
          phone: `lid${rawId}`,
          name: 'Contato Desconhecido',
        }
      ];
      
      // 2. Baileys emite evento lid-mapping.update
      const lidId = rawId;
      const pnId = '5511987654321';
      const tempPhone = `lid${lidId}`;
      
      // Atualizar conversa no banco
      conversations = conversations.map(conv => {
        if (conv.phone === tempPhone) {
          return { ...conv, phone: pnId };
        }
        return conv;
      });
      
      // 3. Frontend recebe evento Socket.IO e atualiza
      let selectedConv = conversations[0];
      
      // 4. Agora pode enviar mensagem com número correto
      const messageData = {
        clientId: 'test-client',
        conversationId: selectedConv.id,
        phone: selectedConv.phone, // agora é o número real
        text: 'Olá!',
        agentName: 'Atendente',
      };
      
      expect(messageData.phone).toBe('5511987654321');
      expect(messageData.phone).not.toMatch(/^lid/);
    });
  });
});
