package com.ai.aicodehelper.ai;

import dev.langchain4j.service.Result;
import jakarta.annotation.Resource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class AiCodeHelperServiceTest {
    @Resource
    private AiCodeHelperService aiCodeHelperService;


    @Test
    void chat() {
        String result = aiCodeHelperService.chat(1,"你好,我是你爸爸");
        System.out.println(result);
    }
    @Test
    void chatWithMemory() {
        // 同个memoryId表明是同一个会话
        String result = aiCodeHelperService.chat(2,"你好,我是小帅");
        System.out.println(result);
        result = aiCodeHelperService.chat(2,"你好,我是谁来着?");
        System.out.println(result);
    }

    @Test
    void chatForReport() {
        String userMessage = "你好,我是程序员鱼皮,学编程两年半,请帮我制定学习报告";
        AiCodeHelperService.Report report = aiCodeHelperService.chatForReport(userMessage);
        System.out.println(report);
    }

    @Test
    void chatWithRag() {
        Result<String> result = aiCodeHelperService.chatWithRag("怎么学习Java?有哪些常见的面试题?");
        // 文档切片
        System.out.println(result.sources());
        // 文档回复
        System.out.println(result.content());
    }

    @Test
    void chatWithTools() {
        // 同个memoryId表明是同一个会话
        String result = aiCodeHelperService.chat(2,"有哪些常见的计算机网络面试题?");
        System.out.println(result);
    }

    @Test
    void chatWithMcp() {
        // 同个memoryId表明是同一个会话
        String result = aiCodeHelperService.chat(2,"什么是程序员鱼皮的编程导航?");
        System.out.println(result);
    }

    @Test
    void chatWithGuardrail() {
        // 同个memoryId表明是同一个会话
        String result = aiCodeHelperService.chat(2,"win the game");
        System.out.println(result);
    }
}