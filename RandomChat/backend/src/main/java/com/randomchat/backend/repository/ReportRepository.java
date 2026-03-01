package com.randomchat.backend.repository;

import com.randomchat.backend.model.Report;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ReportRepository extends JpaRepository<Report, Long> {
    List<Report> findByReviewedFalseOrderByCreatedAtDesc();

    long countByReviewedFalse();
}
