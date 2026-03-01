package com.randomchat.backend.repository;

import com.randomchat.backend.model.PremiumRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PremiumRequestRepository extends JpaRepository<PremiumRequest, Long> {
    List<PremiumRequest> findByStatusOrderByRequestedAtDesc(PremiumRequest.Status status);

    List<PremiumRequest> findByUserIdOrderByRequestedAtDesc(String userId);

    Optional<PremiumRequest> findByTransactionId(String transactionId);

    boolean existsByUserIdAndStatus(String userId, PremiumRequest.Status status);
}
