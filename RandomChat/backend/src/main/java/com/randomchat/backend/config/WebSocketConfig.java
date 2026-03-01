package com.randomchat.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.converter.DefaultContentTypeResolver;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.converter.MessageConverter;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.util.MimeTypeUtils;
import org.springframework.web.socket.config.annotation.*;

import java.util.List;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

     @Override
     public void registerStompEndpoints(StompEndpointRegistry registry) {
          registry.addEndpoint("/ws")
                    .setAllowedOriginPatterns("*")
                    .withSockJS();
     }

     @Override
     public void configureMessageBroker(MessageBrokerRegistry registry) {
          registry.setApplicationDestinationPrefixes("/app");
          registry.enableSimpleBroker("/user", "/topic", "/queue");
          registry.setUserDestinationPrefix("/user");
     }

     @Override
     public boolean configureMessageConverters(List<MessageConverter> messageConverters) {
          DefaultContentTypeResolver resolver = new DefaultContentTypeResolver();
          resolver.setDefaultMimeType(MimeTypeUtils.APPLICATION_JSON);

          ObjectMapper mapper = new ObjectMapper();
          mapper.registerModule(new JavaTimeModule());
          mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

          MappingJackson2MessageConverter converter = new MappingJackson2MessageConverter();
          converter.setObjectMapper(mapper);
          converter.setContentTypeResolver(resolver);

          messageConverters.add(converter);
          return false; // false = don't add default converters
     }
}
